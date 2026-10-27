<?php
declare(strict_types=1);

const SESSION_IDLE_SECONDS = 7200;

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
        'SELECT id, username, email, role, password, verified, deleting, created FROM public."user" WHERE id = $1',
        [$userId]
    );
    if ($result === false) {
        respond(500, ['error' => 'Failed to look up account']);
    }
    $user = pg_fetch_assoc($result);
    if ($user === false || $user['verified'] !== 't' || $user['deleting'] === 't'
        || !hash_equals(hash('sha256', $user['password']), $fingerprint)) {
        $_SESSION = [];
        session_write_close();
        respond(401, ['error' => 'Not authenticated']);
    }
    $_SESSION['last_seen'] = time();
    session_write_close();
    return $user;
}
