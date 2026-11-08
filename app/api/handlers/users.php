<?php
declare(strict_types=1);

function handleListUsers(): never
{
    $currentUser = currentSessionUser();
    if ($currentUser['role'] !== 'admin') {
        respond(403, ['error' => 'Admin access required']);
    }

    header('Cache-Control: no-store');
    $db = connectDb();
    $result = @pg_query(
        $db,
        'SELECT id, username, email, role, verified, approved_at, deleting, created
         FROM public."user" WHERE account_kind = \'human\'
         ORDER BY id'
    );
    if ($result === false) {
        respond(500, ['error' => 'Failed to list users']);
    }

    $users = [];
    while (($row = pg_fetch_assoc($result)) !== false) {
        $user = publicUser($row);
        $user['deleting'] = $row['deleting'] === 't';
        $users[] = $user;
    }
    respond(200, ['users' => $users]);
}

function beginAdminMutation($db, int $adminId): void
{
    if (@pg_query($db, 'BEGIN') === false) {
        respond(500, ['error' => 'Failed to start transaction']);
    }
    // Serialize role changes and deletions so two admins cannot remove each
    // other's access after both passed an earlier session check.
    $lock = @pg_query($db, 'SELECT pg_advisory_xact_lock(20261027, 1)');
    $actor = $lock === false ? false : @pg_query_params(
        $db,
        'SELECT role, verified, approved_at, deleting FROM public."user" WHERE id = $1',
        [$adminId]
    );
    if ($actor === false) {
        @pg_query($db, 'ROLLBACK');
        respond(500, ['error' => 'Failed to authorize admin action']);
    }
    $row = pg_fetch_assoc($actor);
    if ($row === false || $row['role'] !== 'admin' || $row['verified'] !== 't'
        || $row['approved_at'] === null || $row['deleting'] === 't') {
        @pg_query($db, 'ROLLBACK');
        respond(403, ['error' => 'Admin access required']);
    }
}

function handleUpdateUserRole(int $targetId): never
{
    $currentUser = currentSessionUser();
    if ($currentUser['role'] !== 'admin') {
        respond(403, ['error' => 'Admin access required']);
    }

    $payload = readJsonBody();
    $role = $payload['role'] ?? null;
    if (!is_string($role) || !in_array($role, ['admin', 'mod', 'user'], true)) {
        respond(400, ['error' => 'Invalid role']);
    }
    if ($targetId === (int) $currentUser['id']) {
        respond(409, ['error' => 'You cannot change your own role']);
    }

    header('Cache-Control: no-store');
    $db = connectDb();
    beginAdminMutation($db, (int) $currentUser['id']);
    $result = @pg_query_params(
        $db,
        'UPDATE public."user" SET role = $1 WHERE id = $2 AND account_kind = \'human\' AND deleting = FALSE
           AND verified = TRUE AND approved_at IS NOT NULL
         RETURNING id, username, email, role, verified, approved_at, created',
        [$role, $targetId]
    );
    if ($result === false) {
        @pg_query($db, 'ROLLBACK');
        respond(500, ['error' => 'Failed to update user role']);
    }
    $user = pg_fetch_assoc($result);
    if ($user === false) {
        @pg_query($db, 'ROLLBACK');
        respond(404, ['error' => 'User not found']);
    }
    if (@pg_query($db, 'COMMIT') === false) {
        respond(500, ['error' => 'Failed to update user role']);
    }
    respond(200, publicUser($user));
}

function handleApproveUser(int $targetId): never
{
    $currentUser = currentSessionUser();
    if ($currentUser['role'] !== 'admin') {
        respond(403, ['error' => 'Admin access required']);
    }

    header('Cache-Control: no-store');
    $db = connectDb();
    beginAdminMutation($db, (int) $currentUser['id']);
    $targetResult = @pg_query_params($db,
        'SELECT id, verified, approved_at, deleting
         FROM public."user" WHERE id = $1 FOR UPDATE', [$targetId]);
    if ($targetResult === false) {
        @pg_query($db, 'ROLLBACK');
        respond(500, ['error' => 'Failed to approve user']);
    }
    $target = pg_fetch_assoc($targetResult);
    if ($target === false) {
        @pg_query($db, 'ROLLBACK');
        respond(404, ['error' => 'User not found']);
    }
    if ($target['verified'] !== 't' || $target['deleting'] === 't') {
        @pg_query($db, 'ROLLBACK');
        respond(409, ['error' => 'User must verify their email before approval']);
    }
    if ($target['approved_at'] !== null) {
        @pg_query($db, 'ROLLBACK');
        respond(409, ['error' => 'User is already approved']);
    }

    $result = @pg_query_params($db,
        'UPDATE public."user" SET approved_at = CURRENT_TIMESTAMP, approved_by = $2
         WHERE id = $1
         RETURNING id, username, email, role, verified, approved_at, created',
        [$targetId, $currentUser['id']]);
    $user = $result === false ? false : pg_fetch_assoc($result);
    $discard = $user === false ? false : @pg_query_params($db,
        'DELETE FROM public.approval_email_outbox WHERE applicant_id = $1', [$targetId]);
    if ($discard === false || @pg_query($db, 'COMMIT') === false) {
        @pg_query($db, 'ROLLBACK');
        respond(500, ['error' => 'Failed to approve user']);
    }
    respond(200, publicUser($user));
}

function handleDeleteUser(int $targetId): never
{
    $currentUser = currentSessionUser();
    if ($currentUser['role'] !== 'admin') {
        respond(403, ['error' => 'Admin access required']);
    }
    if ($targetId === (int) $currentUser['id']) {
        respond(409, ['error' => 'You cannot delete your own account']);
    }

    header('Cache-Control: no-store');
    $authDb = connectDb();
    beginAdminMutation($authDb, (int) $currentUser['id']);
    $target = @pg_query_params(
        $authDb,
        'SELECT id FROM public."user" WHERE id = $1 AND account_kind = \'human\' FOR UPDATE',
        [$targetId]
    );
    if ($target === false) {
        @pg_query($authDb, 'ROLLBACK');
        respond(500, ['error' => 'Failed to delete user']);
    }
    if (pg_num_rows($target) === 0) {
        @pg_query($authDb, 'ROLLBACK');
        respond(404, ['error' => 'User not found']);
    }
    $marked = @pg_query_params(
        $authDb,
        'UPDATE public."user" SET deleting = TRUE WHERE id = $1',
        [$targetId]
    );
    if ($marked === false) {
        @pg_query($authDb, 'ROLLBACK');
        respond(500, ['error' => 'Failed to delete user']);
    }
    if (@pg_query($authDb, 'COMMIT') === false) {
        respond(500, ['error' => 'Failed to delete user']);
    }

    $serviceRows = @pg_query_params($authDb,
        'SELECT id FROM public."user" WHERE service_owner_id = $1 ORDER BY id', [$targetId]);
    if ($serviceRows === false) respond(500, ['error' => 'Failed to find service accounts']);
    $accountIds = [$targetId];
    while (($service = pg_fetch_assoc($serviceRows)) !== false) $accountIds[] = (int) $service['id'];
    $accountIdArray = '{' . implode(',', $accountIds) . '}';

    // The account is now blocked. A failure below leaves it visible to admins
    // so the same DELETE can safely retry the remaining cleanup.
    $quizDb = connectQuizDb();
    if (@pg_query($quizDb, 'BEGIN') === false) {
        respond(500, ['error' => 'Failed to delete quiz data']);
    }
    $quizLock = true;
    foreach ($accountIds as $accountId) {
        if (@pg_query_params($quizDb, 'SELECT pg_advisory_xact_lock($1)', [$accountId]) === false) {
            $quizLock = false;
            break;
        }
    }
    $quizReceipts = !$quizLock ? false : @pg_query_params($quizDb,
        'DELETE FROM public.quiz_import_receipt WHERE owner_auth_user_id = ANY($1::bigint[])',
        [$accountIdArray]);
    $quizDelete = $quizReceipts === false ? false : @pg_query_params(
        $quizDb,
        'DELETE FROM public."user" WHERE auth_user_id = ANY($1::bigint[])',
        [$accountIdArray]
    );
    if ($quizDelete === false) {
        @pg_query($quizDb, 'ROLLBACK');
        respond(500, ['error' => 'Failed to delete quiz data']);
    }
    if (@pg_query($quizDb, 'COMMIT') === false) {
        respond(500, ['error' => 'Failed to delete quiz data']);
    }

    $musicoDb = connectMusicoDb();
    if (@pg_query($musicoDb, 'BEGIN') === false) {
        respond(500, ['error' => 'Failed to delete Musico data']);
    }
    foreach ($accountIds as $accountId) {
        if (@pg_query_params($musicoDb, 'SELECT pg_advisory_xact_lock($1)', [$accountId]) === false) {
            @pg_query($musicoDb, 'ROLLBACK');
            respond(500, ['error' => 'Failed to delete Musico data']);
        }
    }
    $musicoDelete = @pg_query_params($musicoDb,
        'DELETE FROM public."user" WHERE auth_user_id = ANY($1::bigint[])', [$accountIdArray]);
    if ($musicoDelete === false) {
        @pg_query($musicoDb, 'ROLLBACK');
        respond(500, ['error' => 'Failed to delete Musico data']);
    }
    if (@pg_query($musicoDb, 'COMMIT') === false) {
        respond(500, ['error' => 'Failed to delete Musico data']);
    }

    $mdbDb = connectMdbDb();
    if (@pg_query($mdbDb, 'BEGIN') === false) {
        respond(500, ['error' => 'Failed to delete MDB data']);
    }
    foreach ($accountIds as $accountId) {
        if (@pg_query_params($mdbDb, 'SELECT pg_advisory_xact_lock($1)', [$accountId]) === false) {
            @pg_query($mdbDb, 'ROLLBACK');
            respond(500, ['error' => 'Failed to delete MDB data']);
        }
    }
    $mdbDelete = @pg_query_params($mdbDb,
        'DELETE FROM public."user" WHERE auth_user_id = ANY($1::bigint[])', [$accountIdArray]);
    if ($mdbDelete === false) {
        @pg_query($mdbDb, 'ROLLBACK');
        respond(500, ['error' => 'Failed to delete MDB data']);
    }
    if (@pg_query($mdbDb, 'COMMIT') === false) {
        respond(500, ['error' => 'Failed to delete MDB data']);
    }

    $mediaDb = connectMediaDb();
    if (@pg_query($mediaDb, 'BEGIN') === false) {
        respond(500, ['error' => 'Failed to delete user images']);
    }
    foreach ($accountIds as $accountId) {
        if (@pg_query_params($mediaDb, 'SELECT pg_advisory_xact_lock($1)', [$accountId]) === false) {
            respond(500, ['error' => 'Failed to delete user images']);
        }
    }
    $mediaRecoveries = @pg_query_params($mediaDb,
        'DELETE FROM public.quiz_import_recovery WHERE owner_auth_user_id = ANY($1::bigint[])',
        [$accountIdArray]);
    if ($mediaRecoveries === false) respond(500, ['error' => 'Failed to clean up import recovery']);
    $mediaDelete = @pg_query_params($mediaDb,
        'DELETE FROM public.image WHERE owner_auth_user_id = ANY($1::bigint[])', [$accountIdArray]);
    if ($mediaDelete === false) {
        respond(500, ['error' => 'Failed to delete user images']);
    }
    $mediaGc = @pg_query($mediaDb,
        'DELETE FROM public.image_blob b
         WHERE NOT EXISTS (SELECT 1 FROM public.image i WHERE i.blob_id = b.id)');
    if ($mediaGc === false) {
        respond(500, ['error' => 'Failed to clean up user images']);
    }
    if (@pg_query_params($mediaDb,
        'DELETE FROM public.audio_file WHERE owner_auth_user_id = ANY($1::bigint[])',
        [$accountIdArray]) === false) {
        respond(500, ['error' => 'Failed to delete user audio']);
    }
    if (@pg_query($mediaDb, 'COMMIT') === false) {
        respond(500, ['error' => 'Failed to delete user images']);
    }

    $deleted = @pg_query_params(
        $authDb,
        'DELETE FROM public."user" WHERE id = $1 AND deleting = TRUE',
        [$targetId]
    );
    if ($deleted === false) {
        respond(500, ['error' => 'Failed to delete user']);
    }
    header_remove('Content-Type');
    http_response_code(204);
    exit;
}
