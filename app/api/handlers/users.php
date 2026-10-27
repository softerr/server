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
        'SELECT id, username, email, role, verified, deleting, created
         FROM public."user"
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
        'SELECT role, deleting FROM public."user" WHERE id = $1',
        [$adminId]
    );
    if ($actor === false) {
        @pg_query($db, 'ROLLBACK');
        respond(500, ['error' => 'Failed to authorize admin action']);
    }
    $row = pg_fetch_assoc($actor);
    if ($row === false || $row['role'] !== 'admin' || $row['deleting'] === 't') {
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
        'UPDATE public."user" SET role = $1 WHERE id = $2 AND deleting = FALSE
         RETURNING id, username, email, role, verified, created',
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
        'SELECT id FROM public."user" WHERE id = $1 FOR UPDATE',
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

    // The account is now blocked. A failure below leaves it visible to admins
    // so the same DELETE can safely retry the remaining cleanup.
    $quizDb = connectQuizDb();
    if (@pg_query($quizDb, 'BEGIN') === false) {
        respond(500, ['error' => 'Failed to delete quiz data']);
    }
    $quizLock = @pg_query_params($quizDb, 'SELECT pg_advisory_xact_lock($1)', [$targetId]);
    $quizDelete = $quizLock === false ? false : @pg_query_params(
        $quizDb,
        'DELETE FROM public."user" WHERE auth_user_id = $1',
        [$targetId]
    );
    if ($quizDelete === false) {
        @pg_query($quizDb, 'ROLLBACK');
        respond(500, ['error' => 'Failed to delete quiz data']);
    }
    if (@pg_query($quizDb, 'COMMIT') === false) {
        respond(500, ['error' => 'Failed to delete quiz data']);
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
