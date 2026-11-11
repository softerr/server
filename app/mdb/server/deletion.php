<?php
declare(strict_types=1);

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
    $db = connectAppDb('mdb');
    // Deleting a row clears references in other databases, so it must
    // exclude their writes until the cleanup has committed.
    mdbBeginWrite($db, $user, $databaseId, [], $kind === 'rows');
    if ($kind === 'rows' && ($user['api_token_id'] ?? null) !== null
        && (int) $user['id'] === (int) $user['service_owner_id']) {
        $references = @pg_query_params($db,
            'SELECT DISTINCT c.database_id FROM public.database_column c
             JOIN public.database_cell cell
               ON cell.database_id = c.database_id AND cell.column_id = c.id
             WHERE c.relation_database_id = $1
               AND (c.type = \'relation\' AND cell.value = $2::text
                 OR c.type = \'multi_relation\' AND cell.value::jsonb @> jsonb_build_array($2::bigint))',
            [$databaseId, $itemId]);
        if ($references === false) respond(500, ['error' => 'Failed to check related rows']);
        while (($reference = pg_fetch_assoc($references)) !== false) {
            if (tokenOwnerAccess($user, 'mdb', (int) $reference['database_id'], true) === null) {
                respond(403, ['error' => 'Row is used by a database this token cannot edit']);
            }
        }
    }
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

