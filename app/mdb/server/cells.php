<?php
declare(strict_types=1);

function mdbPublicCellValue(string $type, string $stored): mixed
{
    return match ($type) {
        'checkbox' => $stored === 'true',
        'multi_select' => json_decode($stored, true) ?: [],
        'multi_relation' => json_decode($stored, true) ?: [],
        'relation' => (int) $stored,
        'image' => (int) $stored,
        default => $stored,
    };
}

function mdbCellStorage($db, array $column, mixed $value, ?int $authUserId = null): array
{
    $type = $column['type'];
    if ($type === 'image') {
        if ($value === null) return [null, null];
        if (!is_int($value) || $value < 1 || $authUserId === null) {
            respond(400, ['error' => 'Choose an image from your library']);
        }
        if (@pg_query_params($db, 'SELECT pg_advisory_xact_lock($1::bigint)', [-$value]) === false) {
            respond(500, ['error' => 'Failed to check image']);
        }
        $image = @pg_query_params(connectMediaDb(),
            'SELECT 1 FROM public.image WHERE id = $1
             AND (owner_auth_user_id = $2 OR shared = TRUE)', [$value, $authUserId]);
        if ($image === false) respond(500, ['error' => 'Failed to check image']);
        if (pg_num_rows($image) === 0) respond(400, ['error' => 'Choose an image from your library']);
        return [(string) $value, $value];
    }
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
    if (in_array($column['type'], ['relation', 'multi_relation'], true)
        && ($user['api_token_id'] ?? null) !== null
        && (int) $user['id'] === (int) $user['service_owner_id']
        && tokenOwnerAccess($user, 'mdb', (int) $column['relation_database_id']) === null) {
        respond(403, ['error' => 'Related database is not available to this token']);
    }
    [$stored, $public] = mdbCellStorage($db, $column, $payload['value'], (int) $user['id']);
    if ($column['type'] === 'image' && $public !== null
        && ($user['api_token_id'] ?? null) !== null
        && (int) $user['id'] === (int) $user['service_owner_id']) {
        $image = @pg_query_params(connectMediaDb(),
            'SELECT shared FROM public.image WHERE id = $1', [$public]);
        if ($image === false) respond(500, ['error' => 'Failed to check image access']);
        if (pg_num_rows($image) === 0) respond(400, ['error' => 'Image not found']);
        if (pg_fetch_result($image, 0, 'shared') !== 't'
            && !tokenOwnerImageUsable((int) $public, $user, 'mdb')) {
            respond(403, ['error' => 'Image is outside this token\'s databases']);
        }
    }
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
