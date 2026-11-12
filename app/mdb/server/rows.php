<?php
declare(strict_types=1);

function handleAddMdbRow(array $user, int $databaseId): never
{
    $db = connectAppDb('mdb');
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
    $db = connectAppDb('mdb');
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

function handleGetMdbRowUsage(array $user, int $databaseId, int $rowId): never
{
    $db = connectAppDb('mdb');
    mdbOwnedDatabase($db, $user, $databaseId);
    $row = @pg_query_params($db,
        'SELECT 1 FROM public.database_row WHERE database_id = $1 AND id = $2',
        [$databaseId, $rowId]);
    if ($row === false) respond(500, ['error' => 'Failed to check row']);
    if (pg_num_rows($row) === 0) respond(404, ['error' => 'Row not found']);
    $result = @pg_query_params($db,
        'SELECT d.id AS database_id, d.name AS database_name,
                r.id AS row_id, r.position AS row_position,
                c.id AS column_id, c.name AS column_name, c.type
         FROM public.database_column c
         JOIN public.user_database d ON d.id = c.database_id
         JOIN public."user" u ON u.id = d.user_id
         JOIN public.database_cell cell
           ON cell.database_id = c.database_id AND cell.column_id = c.id
         JOIN public.database_row r
           ON r.database_id = cell.database_id AND r.id = cell.row_id
         WHERE (u.auth_user_id = $1 OR ($4::boolean AND EXISTS (
             SELECT 1 FROM public.database_share s
             WHERE s.database_id = d.id AND s.auth_user_id = $1)))
           AND c.relation_database_id = $2
           AND CASE c.type
             WHEN \'relation\' THEN cell.value = $3::text
             WHEN \'multi_relation\' THEN cell.value::jsonb @> jsonb_build_array($3::bigint)
             ELSE FALSE END
         ORDER BY d.name, r.position, c.position',
        [$user['id'], $databaseId, $rowId, !isset($user['api_token_id']) ? 't' : 'f']);
    if ($result === false) respond(500, ['error' => 'Failed to check row usage']);
    $uses = [];
    while (($usage = pg_fetch_assoc($result)) !== false) {
        if (($user['api_token_id'] ?? null) !== null
            && (int) $user['id'] === (int) $user['service_owner_id']
            && tokenOwnerAccess($user, 'mdb', (int) $usage['database_id']) === null) continue;
        $uses[] = [
            'database_id' => (int) $usage['database_id'],
            'database_name' => $usage['database_name'],
            'row_id' => (int) $usage['row_id'],
            'row_position' => (int) $usage['row_position'],
            'column_id' => (int) $usage['column_id'],
            'column_name' => $usage['column_name'],
            'type' => $usage['type'],
        ];
    }
    respond(200, ['uses' => $uses]);
}

