<?php
declare(strict_types=1);

function publicMdbColumn(array $row): array
{
    $options = json_decode((string) $row['options'], true);
    return ['id' => (int) $row['id'], 'name' => $row['name'],
        'position' => (int) $row['position'], 'type' => $row['type'],
        'width' => $row['width'] === null ? null : (int) $row['width'],
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
        ['text', 'number', 'date', 'checkbox', 'select', 'multi_select', 'relation', 'multi_relation', 'image'], true)) {
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
    if (($user['api_token_id'] ?? null) !== null && (int) $user['id'] === (int) $user['service_owner_id']
        && tokenOwnerAccess($user, 'mdb', $relationId) === null) {
        respond(400, ['error' => 'Related database is not available to this token']);
    }
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

function handleAddMdbColumn(array $user, int $databaseId): never
{
    $payload = readJsonBody(65536);
    $name = mdbName($payload['name'] ?? null);
    [$type, $options, $relationId, $displayId] = mdbColumnSettings($payload ?? []);
    $db = connectAppDb('mdb');
    mdbBeginWrite($db, $user, $databaseId);
    mdbRequireRelatedDatabase($db, $user, $relationId, $displayId);
    $result = @pg_query_params($db,
        'INSERT INTO public.database_column
             (database_id, name, position, type, options, relation_database_id, relation_display_column_id)
         SELECT $1, $2, COALESCE(MAX(position), 0) + 1, $3, $4::jsonb, $5, $6
         FROM public.database_column WHERE database_id = $1
         ON CONFLICT DO NOTHING RETURNING id, name, position, width, type, options, relation_database_id, relation_display_column_id',
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
    $db = connectAppDb('mdb');
    mdbBeginWrite($db, $user, $databaseId);
    $current = @pg_query_params($db,
        'SELECT id, name, position, width, type, options, relation_database_id, relation_display_column_id FROM public.database_column
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
         RETURNING id, name, position, width, type, options, relation_database_id, relation_display_column_id',
        [$databaseId, $columnId, $name, $type, json_encode($options), $relationId, $displayId]);
    if ($updated === false) respond(500, ['error' => 'Failed to update column']);
    $row = pg_fetch_assoc($updated);
    if (@pg_query($db, 'COMMIT') === false) respond(500, ['error' => 'Failed to update column']);
    respond(200, publicMdbColumn($row));
}

function handleResizeMdbColumn(array $user, int $databaseId, int $columnId): never
{
    $payload = readJsonBody();
    $width = $payload['width'] ?? null;
    if (!is_int($width) || $width < 96 || $width > 1200) {
        respond(400, ['error' => 'Column width must be between 96 and 1200 pixels']);
    }
    $db = connectAppDb('mdb');
    mdbBeginWrite($db, $user, $databaseId);
    $updated = @pg_query_params($db,
        'UPDATE public.database_column SET width = $3
         WHERE database_id = $1 AND id = $2
         RETURNING id, name, position, width, type, options, relation_database_id, relation_display_column_id',
        [$databaseId, $columnId, $width]);
    if ($updated === false) respond(500, ['error' => 'Failed to resize column']);
    $row = pg_fetch_assoc($updated);
    if ($row === false) respond(404, ['error' => 'Column not found']);
    if (@pg_query($db, 'COMMIT') === false) respond(500, ['error' => 'Failed to resize column']);
    respond(200, publicMdbColumn($row));
}

