<?php
declare(strict_types=1);

function handleListMdbDatabases(array $user): never
{
    $db = connectAppDb('mdb');
    $result = @pg_query_params($db,
        'SELECT d.id, d.name, d.created, (u.auth_user_id = $5) AS is_owner,
             COALESCE((SELECT s.can_edit FROM public.database_share s
                 WHERE s.database_id = d.id AND s.auth_user_id = $5), FALSE) AS shared_can_edit
         FROM public.user_database d
         JOIN public."user" u ON u.id = d.user_id
         WHERE u.auth_user_id = $1 OR (u.auth_user_id = $2
             AND ($3::boolean OR d.id = ANY($4::bigint[])))
             OR ($6::boolean AND EXISTS (SELECT 1 FROM public.database_share s
                 WHERE s.database_id = d.id AND s.auth_user_id = $5))
         ORDER BY d.id DESC',
        [$user['service_account_id'] ?? $user['id'], $user['service_owner_id'] ?? null,
         tokenOwnerAccess($user, 'mdb') !== null ? 't' : 'f',
         '{' . implode(',', tokenOwnerResourceIds($user, 'mdb')) . '}', $user['id'],
         !isset($user['api_token_id']) ? 't' : 'f']);
    if ($result === false) respond(500, ['error' => 'Failed to load databases']);
    $databases = [];
    while ($row = pg_fetch_assoc($result)) $databases[] = publicMdbDatabase($row);
    respond(200, ['databases' => $databases]);
}

function handleCreateMdbDatabase(array $user): never
{
    $payload = readJsonBody();
    $name = mdbName($payload['name'] ?? null);

    $db = connectAppDb('mdb');
    if (@pg_query($db, 'BEGIN') === false
        || @pg_query_params($db, 'SELECT pg_advisory_xact_lock_shared($1::bigint)',
            [$user['id']]) === false) {
        respond(500, ['error' => 'Failed to create database']);
    }
    $active = @pg_query_params(connectDb(),
        'SELECT 1 FROM public."user" WHERE id = $1
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
    $db = connectAppDb('mdb');
    $database = mdbOwnedDatabase($db, $user, $databaseId);
    $paged = isset($_GET['limit']);
    if (!$paged && isset($_GET['after'])) respond(400, ['error' => 'Invalid row cursor']);
    if ($paged) {
        $limit = filter_var($_GET['limit'], FILTER_VALIDATE_INT,
            ['options' => ['min_range' => 1, 'max_range' => 200]]);
        $after = filter_var($_GET['after'] ?? '0', FILTER_VALIDATE_INT,
            ['options' => ['min_range' => 0]]);
        if ($limit === false || $after === false) respond(400, ['error' => 'Invalid row page']);
    }
    $columnsResult = @pg_query_params($db,
        'SELECT id, name, position, width, type, options, relation_database_id, relation_display_column_id FROM public.database_column
         WHERE database_id = $1 ORDER BY position', [$databaseId]);
    $rowsResult = $paged
        ? @pg_query_params($db,
            'SELECT r.id, r.position, v.column_id, v.value
             FROM (SELECT id, database_id, position FROM public.database_row
                   WHERE database_id = $1 AND position > $2 ORDER BY position LIMIT $3) r
             LEFT JOIN public.database_cell v ON v.database_id = r.database_id AND v.row_id = r.id
             ORDER BY r.position, v.column_id', [$databaseId, $after, $limit + 1])
        : @pg_query_params($db,
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
    $rows = array_values($rows);
    $nextAfter = null;
    if ($paged && count($rows) > $limit) {
        $rows = array_slice($rows, 0, $limit);
        $nextAfter = (string) $rows[count($rows) - 1]['position'];
    }
    $payload = ['database' => publicMdbDatabase($database), 'columns' => $columns,
        'rows' => $rows];
    if ($paged) $payload['next_after'] = $nextAfter;
    respond(200, $payload);
}

