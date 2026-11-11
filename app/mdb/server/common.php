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

// Use the shared owner lock to coordinate with account and image deletion,
// which take the exclusive owner lock. Database locks serialize edits only
// where their data can overlap. The two-key advisory namespace is separate
// from the existing bigint owner and image locks.
function mdbLockDatabases($db, array $databaseIds): void
{
    $databaseIds = array_values(array_unique(array_map('intval', $databaseIds)));
    sort($databaseIds, SORT_NUMERIC);
    foreach ($databaseIds as $id) {
        if ($id < 1) respond(500, ['error' => 'Failed to edit database']);
        $high = intdiv($id, 4294967296);
        $low = $id % 4294967296;
        if ($low >= 2147483648) $low -= 4294967296;
        if (@pg_query_params($db, 'SELECT pg_advisory_xact_lock($1::integer, $2::integer)',
            [$high, $low]) === false) {
            respond(500, ['error' => 'Failed to edit database']);
        }
    }
}

function mdbBeginWrite($db, array $user, int $databaseId,
    array $additionalDatabaseIds = [], bool $exclusiveOwner = false): void
{
    if (@pg_query($db, 'BEGIN') === false
        || @pg_query_params($db, $exclusiveOwner
            ? 'SELECT pg_advisory_xact_lock($1::bigint)'
            : 'SELECT pg_advisory_xact_lock_shared($1::bigint)', [$user['id']]) === false) {
        respond(500, ['error' => 'Failed to edit database']);
    }
    mdbLockDatabases($db, [$databaseId, ...$additionalDatabaseIds]);
    $active = @pg_query_params(connectDb(),
        'SELECT 1 FROM public."user" WHERE id = $1
         AND verified = TRUE AND approved_at IS NOT NULL AND deleting = FALSE', [$user['id']]);
    if ($active === false) respond(500, ['error' => 'Failed to authorize account']);
    if (pg_num_rows($active) === 0) respond(401, ['error' => 'Not authenticated']);
    mdbOwnedDatabase($db, (int) $user['id'], $databaseId);
}

