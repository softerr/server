<?php
declare(strict_types=1);

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
    $start = $payload['start_position'] ?? null;
    if ($start !== null && ($kind !== 'rows' || !is_int($start) || $start < 1
        || count($ids) > 200 || $ids === [] || $start > PHP_INT_MAX - count($ids))) {
        respond(400, ['error' => 'Invalid row page order']);
    }
    $db = connectAppDb('mdb');
    mdbBeginWrite($db, $user, $databaseId);
    $existing = @pg_query_params($db,
        "SELECT id, position FROM {$table} WHERE database_id = $1"
        . ($start === null ? '' : ' AND position >= $2 AND position < $3')
        . ' ORDER BY position', $start === null ? [$databaseId] : [$databaseId, $start, $start + count($ids)]);
    if ($existing === false) respond(500, ['error' => 'Failed to check item order']);
    $actualIds = [];
    while (($row = pg_fetch_assoc($existing)) !== false) {
        $actualIds[] = (int) $row['id'];
    }
    $maximum = @pg_query_params($db,
        "SELECT COALESCE(MAX(position), 0) FROM {$table} WHERE database_id = $1", [$databaseId]);
    if ($maximum === false) respond(500, ['error' => 'Failed to check item order']);
    $maxPosition = (int) pg_fetch_result($maximum, 0, 0);
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
            "UPDATE {$table} SET position = position + $2 WHERE database_id = $1"
            . ($start === null ? '' : ' AND position >= $3 AND position < $4'),
            $start === null ? [$databaseId, $maxPosition]
                : [$databaseId, $maxPosition, $start, $start + count($ids)]);
        $ordered = @pg_query_params($db,
            "UPDATE {$table} item SET position = desired.position + $3
             FROM unnest($2::bigint[]) WITH ORDINALITY AS desired(id, position)
             WHERE item.database_id = $1 AND item.id = desired.id",
            [$databaseId, '{' . implode(',', $ids) . '}', ($start ?? 1) - 1]);
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

