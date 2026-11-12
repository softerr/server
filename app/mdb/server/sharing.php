<?php
declare(strict_types=1);

function mdbShareOwner(array $user, int $databaseId): void
{
    if (($user['account_kind'] ?? 'human') !== 'human') {
        respond(403, ['error' => 'Browser session required to manage sharing']);
    }
    mdbOwnedDatabase(connectAppDb('mdb'), $user, $databaseId, true);
}

function mdbSharePermission(mixed $value): bool
{
    if ($value === 'view') return false;
    if ($value === 'edit') return true;
    respond(400, ['error' => 'Choose view or edit access']);
}

function handleListMdbShares(array $user, int $databaseId): never
{
    mdbShareOwner($user, $databaseId);
    $result = @pg_query_params(connectAppDb('mdb'),
        'SELECT auth_user_id, can_edit FROM public.database_share
         WHERE database_id = $1 ORDER BY created, auth_user_id', [$databaseId]);
    if ($result === false) respond(500, ['error' => 'Failed to load shared users']);
    $shares = [];
    $ids = [];
    while (($row = pg_fetch_assoc($result)) !== false) {
        $id = (int) $row['auth_user_id'];
        $shares[$id] = ['user_id' => $id, 'username' => null,
            'permission' => $row['can_edit'] === 't' ? 'edit' : 'view'];
        $ids[] = $id;
    }
    if ($ids !== []) {
        $users = @pg_query_params(connectDb(),
            'SELECT id, username FROM public."user" WHERE id = ANY($1::bigint[])',
            ['{' . implode(',', $ids) . '}']);
        if ($users === false) respond(500, ['error' => 'Failed to load shared users']);
        while (($row = pg_fetch_assoc($users)) !== false) {
            $shares[(int) $row['id']]['username'] = $row['username'];
        }
    }
    respond(200, ['shares' => array_values($shares)]);
}

function handleAddMdbShare(array $user, int $databaseId): never
{
    mdbShareOwner($user, $databaseId);
    $payload = readJsonBody();
    $username = mdbName($payload['username'] ?? null);
    $canEdit = mdbSharePermission($payload['permission'] ?? null);
    $authDb = connectDb();
    $result = @pg_query_params($authDb,
        'SELECT id, username FROM public."user" WHERE username = $1
         AND account_kind = \'human\' AND verified = TRUE
         AND approved_at IS NOT NULL AND deleting = FALSE', [$username]);
    if ($result === false) respond(500, ['error' => 'Failed to find user']);
    $recipient = pg_fetch_assoc($result);
    if ($recipient === false) respond(404, ['error' => 'User not found']);
    $recipientId = (int) $recipient['id'];
    if ($recipientId === (int) $user['id']) {
        respond(400, ['error' => 'You already own this database']);
    }

    $db = connectAppDb('mdb');
    mdbBeginWrite($db, $user, $databaseId, [], false, true, [$recipientId]);
    $active = @pg_query_params($authDb,
        'SELECT 1 FROM public."user" WHERE id = $1 AND account_kind = \'human\'
         AND verified = TRUE AND approved_at IS NOT NULL AND deleting = FALSE', [$recipientId]);
    if ($active === false) respond(500, ['error' => 'Failed to authorize user']);
    if (pg_num_rows($active) === 0) respond(409, ['error' => 'User is no longer available']);
    $created = @pg_query_params($db,
        'INSERT INTO public.database_share (database_id, auth_user_id, can_edit)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING auth_user_id',
        [$databaseId, $recipientId, $canEdit ? 't' : 'f']);
    if ($created === false) respond(500, ['error' => 'Failed to share database']);
    if (pg_num_rows($created) === 0) respond(409, ['error' => 'Database is already shared with this user']);
    if (@pg_query($db, 'COMMIT') === false) respond(500, ['error' => 'Failed to share database']);
    respond(201, ['user_id' => $recipientId, 'username' => $recipient['username'],
        'permission' => $canEdit ? 'edit' : 'view']);
}

function handleUpdateMdbShare(array $user, int $databaseId, int $recipientId): never
{
    mdbShareOwner($user, $databaseId);
    $payload = readJsonBody();
    $canEdit = mdbSharePermission($payload['permission'] ?? null);
    $db = connectAppDb('mdb');
    mdbBeginWrite($db, $user, $databaseId, [], false, true);
    $updated = @pg_query_params($db,
        'UPDATE public.database_share SET can_edit = $3
         WHERE database_id = $1 AND auth_user_id = $2 RETURNING auth_user_id',
        [$databaseId, $recipientId, $canEdit ? 't' : 'f']);
    if ($updated === false) respond(500, ['error' => 'Failed to update sharing']);
    if (pg_num_rows($updated) === 0) respond(404, ['error' => 'Shared user not found']);
    if (@pg_query($db, 'COMMIT') === false) respond(500, ['error' => 'Failed to update sharing']);
    respond(200, ['user_id' => $recipientId, 'permission' => $canEdit ? 'edit' : 'view']);
}

function handleRemoveMdbShare(array $user, int $databaseId, int $recipientId): never
{
    mdbShareOwner($user, $databaseId);
    $db = connectAppDb('mdb');
    mdbBeginWrite($db, $user, $databaseId, [], false, true);
    $deleted = @pg_query_params($db,
        'DELETE FROM public.database_share
         WHERE database_id = $1 AND auth_user_id = $2 RETURNING auth_user_id',
        [$databaseId, $recipientId]);
    if ($deleted === false) respond(500, ['error' => 'Failed to stop sharing']);
    if (pg_num_rows($deleted) === 0) respond(404, ['error' => 'Shared user not found']);
    if (@pg_query($db, 'COMMIT') === false) respond(500, ['error' => 'Failed to stop sharing']);
    header_remove('Content-Type');
    http_response_code(204);
    exit;
}
