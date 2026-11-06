<?php
declare(strict_types=1);

const SESSION_IDLE_SECONDS = 7200;

function quizGrantOwnerId(array $user, int $quizId, bool $edit = false): ?int
{
    $ownerId = $user['service_owner_id'] ?? null;
    if ($ownerId === null) return null;
    if ($edit && ($user['quiz_edit_owner_id'] ?? null) !== null) return (int) $ownerId;
    if (!$edit && ($user['quiz_read_owner_id'] ?? null) !== null) return (int) $ownerId;
    $permission = ($user['quiz_permissions'] ?? [])[(string) $quizId] ?? null;
    return ($permission === 'edit' || (!$edit && $permission === 'read')) ? (int) $ownerId : null;
}

function readableQuizGrantIds(array $user): array
{
    return array_map('intval', array_keys($user['quiz_permissions'] ?? []));
}

function currentApiTokenUser(string $authorization): array
{
    if (preg_match('/^Bearer (sat_[A-Za-z0-9_-]{43})$/D', $authorization, $match) !== 1) {
        respond(401, ['error' => 'Invalid API token']);
    }
    $db = connectDb();
    $result = @pg_query_params($db,
        'SELECT t.id AS token_id, t.scopes, t.read_owner_quizzes,
                t.edit_owner_quizzes, t.quiz_permissions,
                u.id, u.display_name AS username, u.email, u.role, u.password, u.verified,
                u.approved_at, u.deleting, u.created, u.account_kind, u.service_owner_id
         FROM public.api_token t JOIN public."user" u ON u.id = t.user_id
         JOIN public."user" owner ON owner.id = u.service_owner_id
         WHERE t.token_hash = $1 AND t.revoked_at IS NULL
           AND (t.expires IS NULL OR t.expires > CURRENT_TIMESTAMP)
           AND u.account_kind = \'service\' AND owner.account_kind = \'human\'
           AND owner.verified = TRUE AND owner.approved_at IS NOT NULL AND owner.deleting = FALSE',
        [hash('sha256', $match[1])]);
    if ($result === false) respond(500, ['error' => 'Failed to authenticate API token']);
    $user = pg_fetch_assoc($result);
    if ($user === false || $user['verified'] !== 't' || $user['approved_at'] === null
        || $user['deleting'] === 't') {
        respond(401, ['error' => 'Invalid API token']);
    }
    $path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
    if (is_string($path)) $path = rtrim($path, '/') ?: '/';
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    $scope = null;
    if (is_string($path) && ($path === '/api/quiz/images'
        || str_starts_with($path, '/api/quiz/images/'))) {
        $scope = $method === 'GET' ? 'media:read' : 'media:write';
    } elseif (is_string($path) && str_starts_with($path, '/api/quiz/')) {
        $scope = $method === 'GET' ? 'quiz:read' : 'quiz:write';
    } elseif (is_string($path) && str_starts_with($path, '/api/media/')) {
        $scope = $method === 'GET' ? 'media:read' : 'media:write';
    } elseif ($path !== '/api/auth/me' || $method !== 'GET') {
        respond(403, ['error' => 'API token cannot access this endpoint']);
    }
    $scopes = json_decode($user['scopes'], true);
    if ($scope !== null && (!is_array($scopes) || !in_array($scope, $scopes, true))) {
        respond(403, ['error' => 'API token lacks required scope']);
    }
    header('Cache-Control: private, no-store');
    @pg_query_params($db,
        'UPDATE public.api_token SET last_used_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < CURRENT_TIMESTAMP - INTERVAL \'5 minutes\')',
        [$user['token_id']]);
    $tokenId = (int) $user['token_id'];
    $activityPath = substr(is_string($path) ? $path : '/', 0, 512);
    register_shutdown_function(static function () use ($db, $tokenId, $method, $activityPath): void {
        $status = http_response_code();
        if ($status < 200 || $status >= 300) return;
        $saved = @pg_query_params($db,
            'INSERT INTO public.api_token_activity (token_id, method, path, status)
             VALUES ($1, $2, $3, $4)', [$tokenId, substr($method, 0, 16), $activityPath, $status]);
        if ($saved === false) return;
        @pg_query_params($db,
            'DELETE FROM public.api_token_activity
             WHERE token_id = $1 AND id < COALESCE((
                 SELECT id FROM public.api_token_activity WHERE token_id = $1
                 ORDER BY id DESC OFFSET 99 LIMIT 1), 0)', [$tokenId]);
    });
    $user['api_token_id'] = (int) $user['token_id'];
    $user['quiz_read_owner_id'] = ($user['read_owner_quizzes'] === 't'
        || $user['edit_owner_quizzes'] === 't')
        ? (int) $user['service_owner_id'] : null;
    $user['quiz_edit_owner_id'] = $user['edit_owner_quizzes'] === 't'
        ? (int) $user['service_owner_id'] : null;
    $user['quiz_permissions'] = json_decode($user['quiz_permissions'], true) ?: [];
    unset($user['token_id'], $user['scopes'], $user['read_owner_quizzes'], $user['edit_owner_quizzes']);
    // Service accounts never confer administrator privileges.
    $user['role'] = 'user';
    return $user;
}

function currentMobileTokenUser(string $authorization): array
{
    if (preg_match('/^Bearer (mat_[A-Za-z0-9_-]{43})$/D', $authorization, $match) !== 1) {
        respond(401, ['error' => 'Invalid mobile access token']);
    }
    $path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
    if (is_string($path)) $path = rtrim($path, '/') ?: '/';
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    $mediaImage = is_string($path) && ($path === '/api/media/images'
        || preg_match('#^/api/media/images/[1-9][0-9]*(?:/thumbnail)?$#D', $path) === 1);
    $mediaAudio = is_string($path) && ($path === '/api/media/audio'
        || preg_match('#^/api/media/audio/[1-9][0-9]*$#D', $path) === 1);
    $allowed = is_string($path) && (
        str_starts_with($path, '/api/musico/')
        || ($path === '/api/auth/me' && $method === 'GET')
        || ($method === 'GET' && $mediaImage)
        || ($method === 'POST' && $path === '/api/media/images')
        || ($mediaAudio && in_array($method, ['GET', 'POST', 'DELETE'], true))
    );
    if (!$allowed) respond(403, ['error' => 'Mobile token cannot access this endpoint']);
    $db = connectDb();
    $result = @pg_query_params($db,
        'SELECT u.id, u.username, u.email, u.role, u.password, u.verified,
                u.approved_at, u.deleting, u.created, u.account_kind
         FROM public.mobile_session s JOIN public."user" u ON u.id = s.user_id
         WHERE s.access_hash = $1 AND s.revoked_at IS NULL
           AND s.access_expires > CURRENT_TIMESTAMP AND s.refresh_expires > CURRENT_TIMESTAMP
           AND u.account_kind = \'human\' AND u.verified = TRUE
           AND u.approved_at IS NOT NULL AND u.deleting = FALSE
           AND s.password_fingerprint = encode(digest(u.password, \'sha256\'), \'hex\')',
        [hash('sha256', $match[1])]);
    if ($result === false) respond(500, ['error' => 'Failed to authenticate mobile session']);
    $user = pg_fetch_assoc($result);
    if ($user === false) respond(401, ['error' => 'Mobile session expired']);
    @pg_query_params($db,
        'UPDATE public.mobile_session SET last_used_at = CURRENT_TIMESTAMP
         WHERE access_hash = $1 AND (last_used_at IS NULL
             OR last_used_at < CURRENT_TIMESTAMP - INTERVAL \'5 minutes\')',
        [hash('sha256', $match[1])]);
    header('Cache-Control: private, no-store');
    return $user;
}

function startAuthSession(): void
{
    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_only_cookies', '1');
    ini_set('session.gc_maxlifetime', (string) SESSION_IDLE_SECONDS);
    session_name('softerr_session');
    session_set_cookie_params([
        'lifetime' => 0,
        'path' => '/api/',
        'secure' => ($_SERVER['HTTPS'] ?? '') === 'on'
            || (string) ($_SERVER['SERVER_PORT'] ?? '') === '443'
            || str_starts_with(appBaseUrl() ?? '', 'https://'),
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
    if (!session_start()) {
        respond(500, ['error' => 'Failed to start session']);
    }
}

function currentSessionUser(): array
{
    if (isset($_SERVER['HTTP_AUTHORIZATION']) && $_SERVER['HTTP_AUTHORIZATION'] !== '') {
        $authorization = (string) $_SERVER['HTTP_AUTHORIZATION'];
        return str_starts_with($authorization, 'Bearer mat_')
            ? currentMobileTokenUser($authorization) : currentApiTokenUser($authorization);
    }
    if (!isset($_COOKIE['softerr_session'])) {
        respond(401, ['error' => 'Not authenticated']);
    }
    startAuthSession();
    $userId = $_SESSION['user_id'] ?? null;
    $lastSeen = $_SESSION['last_seen'] ?? null;
    $fingerprint = $_SESSION['password_fingerprint'] ?? null;
    if (!is_int($userId) || !is_int($lastSeen) || !is_string($fingerprint)
        || time() - $lastSeen > SESSION_IDLE_SECONDS) {
        $_SESSION = [];
        session_write_close();
        respond(401, ['error' => 'Not authenticated']);
    }
    $db = connectDb();
    $result = @pg_query_params(
        $db,
        'SELECT id, username, email, role, password, verified, approved_at, deleting, created, account_kind
         FROM public."user" WHERE id = $1',
        [$userId]
    );
    if ($result === false) {
        respond(500, ['error' => 'Failed to look up account']);
    }
    $user = pg_fetch_assoc($result);
    if ($user === false || $user['account_kind'] !== 'human' || $user['verified'] !== 't'
        || $user['approved_at'] === null || $user['deleting'] === 't'
        || !hash_equals(hash('sha256', $user['password']), $fingerprint)) {
        $_SESSION = [];
        session_write_close();
        respond(401, ['error' => 'Not authenticated']);
    }
    $_SESSION['last_seen'] = time();
    session_write_close();
    return $user;
}
