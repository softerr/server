<?php
declare(strict_types=1);

function publicMdbDatabase(array $row): array
{
    return ['id' => (int) $row['id'], 'name' => $row['name'], 'created' => $row['created']];
}

function mdbName(mixed $value): string
{
    if (!is_string($value) || preg_match('//u', $value) !== 1
        || preg_match('/[\x00-\x1f\x7f]/u', $value) === 1) {
        respond(400, ['error' => 'Invalid name']);
    }
    $name = trim($value);
    if ($name === '' || strlen($name) > 100) {
        respond(400, ['error' => 'Name must be between 1 and 100 bytes']);
    }
    return $name;
}

function publicMdbColumn(array $row): array
{
    $options = json_decode((string) $row['options'], true);
    return ['id' => (int) $row['id'], 'name' => $row['name'],
        'position' => (int) $row['position'], 'type' => $row['type'],
        'options' => is_array($options) ? array_values($options) : [],
        'relation_database_id' => $row['relation_database_id'] === null
            ? null : (int) $row['relation_database_id'],
        'relation_display_column_id' => $row['relation_display_column_id'] === null
            ? null : (int) $row['relation_display_column_id']];
}

function mdbColumnSettings(array $payload, ?array $current = null): array
{
    $type = $payload['type'] ?? ($current['type'] ?? 'text');
    if (!is_string($type) || !in_array($type,
        ['text', 'number', 'date', 'checkbox', 'select', 'multi_select', 'relation', 'multi_relation'], true)) {
        respond(400, ['error' => 'Invalid column type']);
    }
    $options = $payload['options'] ?? ($current === null
        ? [] : json_decode((string) $current['options'], true));
    $relationId = array_key_exists('relation_database_id', $payload)
        ? $payload['relation_database_id'] : ($current['relation_database_id'] ?? null);
    $displayId = array_key_exists('relation_display_column_id', $payload)
        ? $payload['relation_display_column_id'] : ($current['relation_display_column_id'] ?? null);
    if ($type === 'select' || $type === 'multi_select') {
        if (!is_array($options) || !array_is_list($options) || $options === []) {
            respond(400, ['error' => 'Add at least one option']);
        }
        $validated = [];
        foreach ($options as $option) {
            $label = mdbName($option);
            if (in_array($label, $validated, true)) respond(400, ['error' => 'Options must be unique']);
            $validated[] = $label;
        }
        return [$type, $validated, null, null];
    }
    if ($type === 'relation' || $type === 'multi_relation') {
        $id = filter_var($relationId, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
        if ($id === false) respond(400, ['error' => 'Choose a related database']);
        if ($displayId !== null) {
            $displayId = filter_var($displayId, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
            if ($displayId === false) respond(400, ['error' => 'Invalid display column']);
        }
        return [$type, [], $id, $displayId];
    }
    return [$type, [], null, null];
}

function mdbRequireRelatedDatabase($db, array $user, ?int $relationId, ?int $displayId): void
{
    if ($relationId === null) return;
    $result = @pg_query_params($db,
        'SELECT 1 FROM public.user_database d JOIN public."user" u ON u.id = d.user_id
         WHERE d.id = $1 AND u.auth_user_id = $2', [$relationId, $user['id']]);
    if ($result === false) respond(500, ['error' => 'Failed to check related database']);
    if (pg_num_rows($result) === 0) respond(400, ['error' => 'Related database not found']);
    if ($displayId === null) return;
    $column = @pg_query_params($db,
        'SELECT 1 FROM public.database_column WHERE id = $1 AND database_id = $2',
        [$displayId, $relationId]);
    if ($column === false) respond(500, ['error' => 'Failed to check display column']);
    if (pg_num_rows($column) === 0) respond(400, ['error' => 'Display column not found in related database']);
}

function mdbPublicCellValue(string $type, string $stored): mixed
{
    return match ($type) {
        'checkbox' => $stored === 'true',
        'multi_select' => json_decode($stored, true) ?: [],
        'multi_relation' => json_decode($stored, true) ?: [],
        'relation' => (int) $stored,
        default => $stored,
    };
}

function mdbCellStorage($db, array $column, mixed $value): array
{
    $type = $column['type'];
    if ($type === 'checkbox') {
        if (!is_bool($value)) respond(400, ['error' => 'Checkbox value must be true or false']);
        return [$value ? 'true' : null, $value];
    }
    if ($type === 'multi_select') {
        $options = json_decode((string) $column['options'], true) ?: [];
        if (!is_array($value) || !array_is_list($value)) {
            respond(400, ['error' => 'Multi-select value must be a list']);
        }
        foreach ($value as $option) {
            if (!is_string($option) || !in_array($option, $options, true)) {
                respond(400, ['error' => 'Unknown option']);
            }
        }
        $selected = array_values(array_filter($options,
            static fn (string $option): bool => in_array($option, $value, true)));
        if (count($selected) !== count($value)) respond(400, ['error' => 'Duplicate option']);
        return [$selected === [] ? null : json_encode($selected), $selected];
    }
    if ($type === 'multi_relation') {
        if (!is_array($value) || !array_is_list($value)) {
            respond(400, ['error' => 'Multi-relation value must be a list of row IDs']);
        }
        foreach ($value as $rowId) {
            if (!is_int($rowId) || $rowId < 1) respond(400, ['error' => 'Invalid related row']);
        }
        if (count($value) !== count(array_unique($value))) {
            respond(400, ['error' => 'Related rows must be unique']);
        }
        if ($value === []) return [null, []];
        $related = @pg_query_params($db,
            'SELECT id FROM public.database_row
             WHERE database_id = $1 AND id = ANY($2::bigint[]) ORDER BY position',
            [$column['relation_database_id'], '{' . implode(',', $value) . '}']);
        if ($related === false) respond(500, ['error' => 'Failed to check related rows']);
        if (pg_num_rows($related) !== count($value)) {
            respond(400, ['error' => 'Related row not found']);
        }
        $selected = [];
        while (($row = pg_fetch_assoc($related)) !== false) $selected[] = (int) $row['id'];
        return [json_encode($selected), $selected];
    }
    if ($type === 'relation') {
        if ($value === null || $value === '') return [null, null];
        $rowId = filter_var($value, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
        if ($rowId === false) respond(400, ['error' => 'Invalid related row']);
        $targetId = $column['relation_database_id'];
        $related = @pg_query_params($db,
            'SELECT 1 FROM public.database_row WHERE id = $1 AND database_id = $2',
            [$rowId, $targetId]);
        if ($related === false) respond(500, ['error' => 'Failed to check related row']);
        if (pg_num_rows($related) === 0) respond(400, ['error' => 'Related row not found']);
        return [(string) $rowId, $rowId];
    }
    if (!is_string($value) || preg_match('//u', $value) !== 1
        || strlen($value) > 60000 || str_contains($value, "\0")) {
        respond(400, ['error' => 'Cell value must be text up to 60000 bytes']);
    }
    if ($type === 'number') {
        $value = trim($value);
        if ($value !== '' && (strlen($value) > 100 || preg_match(
            '/^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/D', $value) !== 1)) {
            respond(400, ['error' => 'Invalid number']);
        }
    } elseif ($type === 'date' && $value !== '') {
        $date = DateTimeImmutable::createFromFormat('!Y-m-d', $value);
        if ($date === false || $date->format('Y-m-d') !== $value) {
            respond(400, ['error' => 'Invalid date']);
        }
    } elseif ($type === 'select' && $value !== '') {
        $options = json_decode((string) $column['options'], true) ?: [];
        if (!in_array($value, $options, true)) respond(400, ['error' => 'Unknown option']);
    }
    return [$value === '' ? null : $value, $value];
}

function mdbOwnedDatabase($db, int $authUserId, int $databaseId): array
{
    $result = @pg_query_params($db,
        'SELECT d.id, d.name, d.created FROM public.user_database d
         JOIN public."user" u ON u.id = d.user_id
         WHERE d.id = $1 AND u.auth_user_id = $2', [$databaseId, $authUserId]);
    if ($result === false) respond(500, ['error' => 'Failed to load database']);
    $row = pg_fetch_assoc($result);
    if ($row === false) respond(404, ['error' => 'Database not found']);
    return $row;
}

function mdbBeginWrite($db, array $user, int $databaseId): void
{
    if (@pg_query($db, 'BEGIN') === false
        || @pg_query_params($db, 'SELECT pg_advisory_xact_lock($1)', [$user['id']]) === false) {
        respond(500, ['error' => 'Failed to edit database']);
    }
    $active = @pg_query_params(connectDb(),
        'SELECT 1 FROM public."user" WHERE id = $1 AND account_kind = \'human\'
         AND verified = TRUE AND approved_at IS NOT NULL AND deleting = FALSE', [$user['id']]);
    if ($active === false) respond(500, ['error' => 'Failed to authorize account']);
    if (pg_num_rows($active) === 0) respond(401, ['error' => 'Not authenticated']);
    mdbOwnedDatabase($db, (int) $user['id'], $databaseId);
}

function handleListMdbDatabases(array $user): never
{
    $db = connectMdbDb();
    $result = @pg_query_params($db,
        'SELECT d.id, d.name, d.created FROM public.user_database d
         JOIN public."user" u ON u.id = d.user_id
         WHERE u.auth_user_id = $1 ORDER BY d.id DESC', [$user['id']]);
    if ($result === false) respond(500, ['error' => 'Failed to load databases']);
    $databases = [];
    while ($row = pg_fetch_assoc($result)) $databases[] = publicMdbDatabase($row);
    respond(200, ['databases' => $databases]);
}

function handleCreateMdbDatabase(array $user): never
{
    $payload = readJsonBody();
    $name = mdbName($payload['name'] ?? null);

    $db = connectMdbDb();
    if (@pg_query($db, 'BEGIN') === false
        || @pg_query_params($db, 'SELECT pg_advisory_xact_lock($1)', [$user['id']]) === false) {
        respond(500, ['error' => 'Failed to create database']);
    }
    $active = @pg_query_params(connectDb(),
        'SELECT 1 FROM public."user" WHERE id = $1 AND account_kind = \'human\'
         AND verified = TRUE AND approved_at IS NOT NULL AND deleting = FALSE', [$user['id']]);
    if ($active === false) respond(500, ['error' => 'Failed to authorize account']);
    if (pg_num_rows($active) === 0) respond(401, ['error' => 'Not authenticated']);
    $local = @pg_query_params($db,
        'INSERT INTO public."user" (auth_user_id) VALUES ($1)
         ON CONFLICT (auth_user_id) DO NOTHING', [$user['id']]);
    if ($local === false) respond(500, ['error' => 'Failed to create database']);
    $local = @pg_query_params($db,
        'SELECT id FROM public."user" WHERE auth_user_id = $1', [$user['id']]);
    if ($local === false || pg_num_rows($local) !== 1) respond(500, ['error' => 'Failed to create database']);
    $localId = pg_fetch_result($local, 0, 0);
    $created = @pg_query_params($db,
        'INSERT INTO public.user_database (user_id, name) VALUES ($1, $2)
         ON CONFLICT DO NOTHING RETURNING id, name, created', [$localId, $name]);
    if ($created === false) respond(500, ['error' => 'Failed to create database']);
    $row = pg_fetch_assoc($created);
    if ($row === false) respond(409, ['error' => 'A database with this name already exists']);
    if (@pg_query($db, 'COMMIT') === false) respond(500, ['error' => 'Failed to create database']);
    respond(201, publicMdbDatabase($row));
}

function handleGetMdbDatabase(array $user, int $databaseId): never
{
    $db = connectMdbDb();
    $database = mdbOwnedDatabase($db, (int) $user['id'], $databaseId);
    $columnsResult = @pg_query_params($db,
        'SELECT id, name, position, type, options, relation_database_id, relation_display_column_id FROM public.database_column
         WHERE database_id = $1 ORDER BY position', [$databaseId]);
    $rowsResult = @pg_query_params($db,
        'SELECT r.id, r.position, v.column_id, v.value
         FROM public.database_row r
         LEFT JOIN public.database_cell v ON v.database_id = r.database_id AND v.row_id = r.id
         WHERE r.database_id = $1 ORDER BY r.position, v.column_id', [$databaseId]);
    if ($columnsResult === false || $rowsResult === false) {
        respond(500, ['error' => 'Failed to load database table']);
    }
    $columns = [];
    $columnTypes = [];
    while (($column = pg_fetch_assoc($columnsResult)) !== false) {
        $columns[] = publicMdbColumn($column);
        $columnTypes[$column['id']] = $column['type'];
    }
    $rows = [];
    while (($row = pg_fetch_assoc($rowsResult)) !== false) {
        $id = (int) $row['id'];
        if (!isset($rows[$id])) {
            $rows[$id] = ['id' => $id, 'position' => (int) $row['position'], 'values' => []];
        }
        if ($row['column_id'] !== null) {
            $rows[$id]['values'][(string) $row['column_id']] =
                mdbPublicCellValue($columnTypes[$row['column_id']] ?? 'text', $row['value']);
        }
    }
    foreach ($rows as &$row) $row['values'] = (object) $row['values'];
    unset($row);
    respond(200, ['database' => publicMdbDatabase($database), 'columns' => $columns,
        'rows' => array_values($rows)]);
}

function handleAddMdbColumn(array $user, int $databaseId): never
{
    $payload = readJsonBody(65536);
    $name = mdbName($payload['name'] ?? null);
    [$type, $options, $relationId, $displayId] = mdbColumnSettings($payload ?? []);
    $db = connectMdbDb();
    mdbBeginWrite($db, $user, $databaseId);
    mdbRequireRelatedDatabase($db, $user, $relationId, $displayId);
    $result = @pg_query_params($db,
        'INSERT INTO public.database_column
             (database_id, name, position, type, options, relation_database_id, relation_display_column_id)
         SELECT $1, $2, COALESCE(MAX(position), 0) + 1, $3, $4::jsonb, $5, $6
         FROM public.database_column WHERE database_id = $1
         ON CONFLICT DO NOTHING RETURNING id, name, position, type, options, relation_database_id, relation_display_column_id',
        [$databaseId, $name, $type, json_encode($options), $relationId, $displayId]);
    if ($result === false) respond(500, ['error' => 'Failed to add column']);
    $row = pg_fetch_assoc($result);
    if ($row === false) respond(409, ['error' => 'A column with this name already exists']);
    if (@pg_query($db, 'COMMIT') === false) respond(500, ['error' => 'Failed to add column']);
    respond(201, publicMdbColumn($row));
}

function handleUpdateMdbColumn(array $user, int $databaseId, int $columnId): never
{
    $payload = readJsonBody(65536);
    $name = mdbName($payload['name'] ?? null);
    $db = connectMdbDb();
    mdbBeginWrite($db, $user, $databaseId);
    $current = @pg_query_params($db,
        'SELECT id, name, position, type, options, relation_database_id, relation_display_column_id FROM public.database_column
         WHERE database_id = $1 AND id = $2', [$databaseId, $columnId]);
    if ($current === false) respond(500, ['error' => 'Failed to update column']);
    $row = pg_fetch_assoc($current);
    if ($row === false) respond(404, ['error' => 'Column not found']);
    [$type, $options, $relationId, $displayId] = mdbColumnSettings($payload ?? [], $row);
    $oldOptions = json_decode((string) $row['options'], true) ?: [];
    $renamePairs = $payload['option_renames'] ?? [];
    if (!is_array($renamePairs) || !array_is_list($renamePairs)) {
        respond(400, ['error' => 'Invalid option renames']);
    }
    $renames = [];
    foreach ($renamePairs as $pair) {
        if (!is_array($pair) || !is_string($pair['from'] ?? null)
            || !is_string($pair['to'] ?? null)
            || !in_array($pair['from'], $oldOptions, true)
            || !in_array($pair['to'], $options, true)
            || array_key_exists($pair['from'], $renames)) {
            respond(400, ['error' => 'Invalid option renames']);
        }
        $renames[$pair['from']] = $pair['to'];
    }
    if ($renames !== [] && ($row['type'] !== $type
        || !in_array($type, ['select', 'multi_select'], true))) {
        respond(400, ['error' => 'Option renames require a select column']);
    }
    mdbRequireRelatedDatabase($db, $user, $relationId, $displayId);
    $duplicate = @pg_query_params($db,
        'SELECT 1 FROM public.database_column
         WHERE database_id = $1 AND id <> $2 AND lower(name) = lower($3)',
        [$databaseId, $columnId, $name]);
    if ($duplicate === false) respond(500, ['error' => 'Failed to update column']);
    if (pg_num_rows($duplicate) > 0) respond(409, ['error' => 'A column with this name already exists']);
    $typeChanged = $type !== $row['type']
        || $relationId !== ($row['relation_database_id'] === null ? null : (int) $row['relation_database_id']);
    if ($typeChanged) {
        $existing = @pg_query_params($db,
            'SELECT 1 FROM public.database_cell WHERE database_id = $1 AND column_id = $2 LIMIT 1',
            [$databaseId, $columnId]);
        if ($existing === false) respond(500, ['error' => 'Failed to check column values']);
        if (pg_num_rows($existing) > 0) {
            respond(409, ['error' => 'Clear this column before changing its type or related database']);
        }
    }
    $cellUpdates = [];
    if (($type === 'select' || $type === 'multi_select')
        && ($options !== $oldOptions || $renames !== [])) {
        $values = @pg_query_params($db,
            'SELECT row_id, value FROM public.database_cell WHERE database_id = $1 AND column_id = $2',
            [$databaseId, $columnId]);
        if ($values === false) respond(500, ['error' => 'Failed to check column values']);
        while (($value = pg_fetch_assoc($values)) !== false) {
            $selected = $type === 'select' ? [$value['value']] : json_decode($value['value'], true);
            if (!is_array($selected) || !array_is_list($selected)) {
                respond(409, ['error' => 'An option is still used by a cell']);
            }
            $mapped = array_map(static fn (string $item): string => $renames[$item] ?? $item, $selected);
            if (array_diff($mapped, $options) !== []
                || count(array_unique($mapped, SORT_STRING)) !== count($mapped)) {
                respond(409, ['error' => 'An option is still used by a cell']);
            }
            $next = $type === 'select' ? $mapped[0] : json_encode(array_values(array_filter($options,
                static fn (string $option): bool => in_array($option, $mapped, true))));
            if ($next !== $value['value']) $cellUpdates[] = [$value['row_id'], $next];
        }
    }
    foreach ($cellUpdates as [$rowId, $next]) {
        $updatedCell = @pg_query_params($db,
            'UPDATE public.database_cell SET value = $4
             WHERE database_id = $1 AND column_id = $2 AND row_id = $3',
            [$databaseId, $columnId, $rowId, $next]);
        if ($updatedCell === false) respond(500, ['error' => 'Failed to update option values']);
    }
    $updated = @pg_query_params($db,
        'UPDATE public.database_column
         SET name = $3, type = $4, options = $5::jsonb, relation_database_id = $6,
             relation_display_column_id = $7
         WHERE database_id = $1 AND id = $2
         RETURNING id, name, position, type, options, relation_database_id, relation_display_column_id',
        [$databaseId, $columnId, $name, $type, json_encode($options), $relationId, $displayId]);
    if ($updated === false) respond(500, ['error' => 'Failed to update column']);
    $row = pg_fetch_assoc($updated);
    if (@pg_query($db, 'COMMIT') === false) respond(500, ['error' => 'Failed to update column']);
    respond(200, publicMdbColumn($row));
}

function handleAddMdbRow(array $user, int $databaseId): never
{
    $db = connectMdbDb();
    mdbBeginWrite($db, $user, $databaseId);
    $result = @pg_query_params($db,
        'INSERT INTO public.database_row (database_id, position)
         SELECT $1, COALESCE(MAX(position), 0) + 1
         FROM public.database_row WHERE database_id = $1
         RETURNING id, position', [$databaseId]);
    if ($result === false) respond(500, ['error' => 'Failed to add row']);
    $row = pg_fetch_assoc($result);
    if (@pg_query($db, 'COMMIT') === false) respond(500, ['error' => 'Failed to add row']);
    respond(201, ['id' => (int) $row['id'], 'position' => (int) $row['position'],
        'values' => new stdClass()]);
}

function handleAddMdbRows(array $user, int $databaseId): never
{
    $payload = readJsonBody(65536);
    $values = $payload['values'] ?? null;
    $columnId = $payload['column_id'] ?? null;
    if (!is_array($values) || !array_is_list($values) || $values === [] || count($values) > 100
        || ($columnId !== null && (!is_int($columnId) || $columnId < 1))) {
        respond(400, ['error' => 'Provide 1 to 100 row values and a valid column']);
    }
    $db = connectMdbDb();
    mdbBeginWrite($db, $user, $databaseId);
    $column = null;
    if ($columnId !== null) {
        $result = @pg_query_params($db,
            'SELECT type, options FROM public.database_column WHERE database_id = $1 AND id = $2',
            [$databaseId, $columnId]);
        if ($result === false) respond(500, ['error' => 'Failed to inspect row column']);
        $column = pg_fetch_assoc($result);
        if ($column === false || !in_array($column['type'], ['text', 'number', 'date', 'select'], true)) {
            respond(400, ['error' => 'Choose a text, number, date, or select column']);
        }
    }
    $storedValues = [];
    foreach ($values as $value) {
        if ($column === null) {
            if ($value !== null) respond(400, ['error' => 'Blank rows must have null values']);
            $storedValues[] = null;
            continue;
        }
        if (!is_string($value) || trim($value) === '') {
            respond(400, ['error' => 'Enter a value for each new row']);
        }
        $storedValues[] = mdbCellStorage($db, $column, trim($value));
    }
    $maximumResult = @pg_query_params($db,
        'SELECT COALESCE(MAX(position), 0) FROM public.database_row WHERE database_id = $1', [$databaseId]);
    if ($maximumResult === false) respond(500, ['error' => 'Failed to add related rows']);
    $position = (int) pg_fetch_result($maximumResult, 0, 0);
    if ($position > PHP_INT_MAX - count($values)) respond(409, ['error' => 'No room to add rows']);
    $rows = [];
    foreach ($storedValues as $storedValue) {
        $position++;
        $created = @pg_query_params($db,
            'INSERT INTO public.database_row (database_id, position) VALUES ($1, $2) RETURNING id',
            [$databaseId, $position]);
        if ($created === false) respond(500, ['error' => 'Failed to add related rows']);
        $id = (int) pg_fetch_result($created, 0, 0);
        $publicValues = [];
        if ($storedValue !== null) {
            [$stored, $public] = $storedValue;
            $inserted = @pg_query_params($db,
                'INSERT INTO public.database_cell (database_id, row_id, column_id, value)
                 VALUES ($1, $2, $3, $4)', [$databaseId, $id, $columnId, $stored]);
            if ($inserted === false) respond(500, ['error' => 'Failed to add related row value']);
            $publicValues[(string) $columnId] = $public;
        }
        $rows[] = ['id' => $id, 'position' => $position, 'values' => (object) $publicValues];
    }
    if (@pg_query($db, 'COMMIT') === false) respond(500, ['error' => 'Failed to add related rows']);
    respond(201, ['rows' => $rows]);
}

function handleReorderMdbItems(array $user, int $databaseId, string $kind): never
{
    $payload = readJsonBody(1048576);
    $ids = $payload['ids'] ?? null;
    if (!is_array($ids) || !array_is_list($ids)) {
        respond(400, ['error' => 'Ordered IDs must be a list']);
    }
    foreach ($ids as $id) {
        if (!is_int($id) || $id < 1) respond(400, ['error' => 'Invalid ordered ID']);
    }
    if (count($ids) !== count(array_unique($ids))) {
        respond(400, ['error' => 'Ordered IDs must be unique']);
    }
    $table = match ($kind) {
        'columns' => 'public.database_column',
        'rows' => 'public.database_row',
        default => respond(404, ['error' => 'Not found']),
    };
    $db = connectMdbDb();
    mdbBeginWrite($db, $user, $databaseId);
    $existing = @pg_query_params($db,
        "SELECT id, position FROM {$table} WHERE database_id = $1 ORDER BY position", [$databaseId]);
    if ($existing === false) respond(500, ['error' => 'Failed to check item order']);
    $actualIds = [];
    $maxPosition = 0;
    while (($row = pg_fetch_assoc($existing)) !== false) {
        $actualIds[] = (int) $row['id'];
        $maxPosition = max($maxPosition, (int) $row['position']);
    }
    $sortedIds = $ids;
    sort($sortedIds, SORT_NUMERIC);
    sort($actualIds, SORT_NUMERIC);
    if ($sortedIds !== $actualIds) respond(409, ['error' => 'Item order has changed; reload and try again']);
    if ($ids !== []) {
        $limit = $kind === 'columns' ? 2147483647 : PHP_INT_MAX;
        if ($maxPosition > $limit - count($ids)) {
            respond(409, ['error' => 'No room to reorder items']);
        }
        $shifted = @pg_query_params($db,
            "UPDATE {$table} SET position = position + $2 WHERE database_id = $1",
            [$databaseId, $maxPosition]);
        $ordered = @pg_query_params($db,
            "UPDATE {$table} item SET position = desired.position
             FROM unnest($2::bigint[]) WITH ORDINALITY AS desired(id, position)
             WHERE item.database_id = $1 AND item.id = desired.id",
            [$databaseId, '{' . implode(',', $ids) . '}']);
        if ($shifted === false || $ordered === false
            || pg_affected_rows($shifted) !== count($ids)
            || pg_affected_rows($ordered) !== count($ids)) {
            respond(500, ['error' => 'Failed to reorder items']);
        }
    }
    if (@pg_query($db, 'COMMIT') === false) respond(500, ['error' => 'Failed to reorder items']);
    respond(200, ['ids' => $ids]);
}

function mdbCompactPositionsAfterDelete($db, string $table, int $databaseId, int $deletedPosition, int $limit): void
{
    $result = @pg_query_params($db,
        "SELECT COALESCE(MAX(position), 0) AS maximum FROM {$table} WHERE database_id = $1", [$databaseId]);
    if ($result === false) respond(500, ['error' => 'Failed to compact item order']);
    $maximum = (int) pg_fetch_result($result, 0, 'maximum');
    if ($maximum <= $deletedPosition) return;
    if ($maximum <= intdiv($limit, 2)) {
        $shifted = @pg_query_params($db,
            "UPDATE {$table} SET position = position + $2 WHERE database_id = $1 AND position > $3",
            [$databaseId, $maximum, $deletedPosition]);
        $restored = $shifted === false ? false : @pg_query_params($db,
            "UPDATE {$table} SET position = position - $2 - 1 WHERE database_id = $1 AND position > $2",
            [$databaseId, $maximum]);
        if ($shifted === false || $restored === false) {
            respond(500, ['error' => 'Failed to compact item order']);
        }
        return;
    }
    $remaining = @pg_query_params($db,
        "SELECT id FROM {$table} WHERE database_id = $1 AND position > $2 ORDER BY position",
        [$databaseId, $deletedPosition]);
    if ($remaining === false) respond(500, ['error' => 'Failed to compact item order']);
    while (($row = pg_fetch_assoc($remaining)) !== false) {
        $updated = @pg_query_params($db,
            "UPDATE {$table} SET position = position - 1 WHERE database_id = $1 AND id = $2",
            [$databaseId, $row['id']]);
        if ($updated === false) respond(500, ['error' => 'Failed to compact item order']);
    }
}

function mdbClearDeletedRowReferences($db, int $databaseId, int $rowId): void
{
    $cleared = @pg_query_params($db,
        'DELETE FROM public.database_cell cell USING public.database_column col
         WHERE cell.database_id = col.database_id AND cell.column_id = col.id
           AND col.type = \'relation\' AND col.relation_database_id = $1
           AND cell.value = $2::text', [$databaseId, $rowId]);
    if ($cleared === false) respond(500, ['error' => 'Failed to clear related rows']);
    $related = @pg_query_params($db,
        'SELECT cell.database_id, cell.row_id, cell.column_id, cell.value
         FROM public.database_cell cell JOIN public.database_column col
           ON col.database_id = cell.database_id AND col.id = cell.column_id
         WHERE col.type = \'multi_relation\' AND col.relation_database_id = $1', [$databaseId]);
    if ($related === false) respond(500, ['error' => 'Failed to clear related rows']);
    while (($cell = pg_fetch_assoc($related)) !== false) {
        $ids = json_decode($cell['value'], true);
        if (!is_array($ids) || !in_array($rowId, $ids, true)) continue;
        $remaining = array_values(array_filter($ids,
            static fn (int $id): bool => $id !== $rowId));
        if ($remaining === []) {
            $updated = @pg_query_params($db,
                'DELETE FROM public.database_cell WHERE database_id = $1 AND row_id = $2 AND column_id = $3',
                [$cell['database_id'], $cell['row_id'], $cell['column_id']]);
        } else {
            $updated = @pg_query_params($db,
                'UPDATE public.database_cell SET value = $4
                 WHERE database_id = $1 AND row_id = $2 AND column_id = $3',
                [$cell['database_id'], $cell['row_id'], $cell['column_id'], json_encode($remaining)]);
        }
        if ($updated === false) respond(500, ['error' => 'Failed to clear related rows']);
    }
}

function handleDeleteMdbItem(array $user, int $databaseId, int $itemId, string $kind): never
{
    $table = match ($kind) {
        'columns' => 'public.database_column',
        'rows' => 'public.database_row',
        default => respond(404, ['error' => 'Not found']),
    };
    $db = connectMdbDb();
    mdbBeginWrite($db, $user, $databaseId);
    $deleted = @pg_query_params($db,
        "DELETE FROM {$table} WHERE database_id = $1 AND id = $2 RETURNING position",
        [$databaseId, $itemId]);
    if ($deleted === false) respond(500, ['error' => 'Failed to delete item']);
    if (pg_num_rows($deleted) === 0) respond(404, ['error' => 'Row or column not found']);
    if ($kind === 'rows') mdbClearDeletedRowReferences($db, $databaseId, $itemId);
    $position = (int) pg_fetch_result($deleted, 0, 'position');
    mdbCompactPositionsAfterDelete($db, $table, $databaseId, $position,
        $kind === 'columns' ? 2147483647 : PHP_INT_MAX);
    if (@pg_query($db, 'COMMIT') === false) respond(500, ['error' => 'Failed to delete item']);
    http_response_code(204);
    exit;
}

function handleSaveMdbCell(array $user, int $databaseId, int $rowId, int $columnId): never
{
    $payload = readJsonBody(65536);
    if (!is_array($payload) || !array_key_exists('value', $payload)) {
        respond(400, ['error' => 'Cell value is required']);
    }
    $db = connectMdbDb();
    mdbBeginWrite($db, $user, $databaseId);
    $members = @pg_query_params($db,
        'SELECT c.type, c.options, c.relation_database_id
         FROM public.database_row r, public.database_column c
         WHERE r.database_id = $1 AND r.id = $2 AND c.database_id = $1 AND c.id = $3',
        [$databaseId, $rowId, $columnId]);
    if ($members === false) respond(500, ['error' => 'Failed to save cell']);
    $column = pg_fetch_assoc($members);
    if ($column === false) respond(404, ['error' => 'Row or column not found']);
    [$stored, $public] = mdbCellStorage($db, $column, $payload['value']);
    if ($stored === null) {
        $saved = @pg_query_params($db,
            'DELETE FROM public.database_cell WHERE database_id = $1 AND row_id = $2 AND column_id = $3',
            [$databaseId, $rowId, $columnId]);
    } else {
        $saved = @pg_query_params($db,
            'INSERT INTO public.database_cell (database_id, row_id, column_id, value)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (row_id, column_id) DO UPDATE SET value = EXCLUDED.value',
            [$databaseId, $rowId, $columnId, $stored]);
    }
    if ($saved === false || @pg_query($db, 'COMMIT') === false) {
        respond(500, ['error' => 'Failed to save cell']);
    }
    respond(200, ['row_id' => $rowId, 'column_id' => $columnId, 'value' => $public]);
}
