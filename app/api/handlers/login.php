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

function publicUser(array $user): array
{
    return [
        'id' => (int) $user['id'],
        'username' => $user['username'],
        'email' => $user['email'],
        'verified' => $user['verified'] === 't',
        'created' => $user['created'],
    ];
}

function handleLogin(): never
{
    $payload = readJsonBody();
    if ($payload === null || !is_string($payload['email'] ?? null)
        || !is_string($payload['password'] ?? null)) {
        respond(400, ['error' => 'email and password are required']);
    }

    $email = strtolower(trim($payload['email']));
    $password = $payload['password'];
    if ($email === '' || $password === '' || strlen($email) > 255
        || strlen($password) > 1024 || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        respond(400, ['error' => 'Invalid email or password']);
    }

    $db = connectDb();
    $result = @pg_query_params(
        $db,
        'SELECT id, username, email, password, verified, created
         FROM public."user" WHERE email = $1 LIMIT 1',
        [$email]
    );
    if ($result === false) {
        respond(500, ['error' => 'Failed to look up account']);
    }

    $user = pg_fetch_assoc($result);
    // Check a real hash even for unknown accounts to reduce timing differences.
    $hash = $user === false
        ? '$2y$10$uAGgdiL4W0DQXR9FcetBoeBgsivB9wz7PKyZGg0bS54SNG7ft9LFy'
        : $user['password'];
    if (!password_verify($password, $hash) || $user === false) {
        respond(401, ['error' => 'Invalid email or password']);
    }
    if ($user['verified'] !== 't') {
        respond(403, ['error' => 'Verify your email before logging in']);
    }

    startAuthSession();
    $_SESSION = [];
    if (!session_regenerate_id(true)) {
        respond(500, ['error' => 'Failed to create session']);
    }
    $_SESSION['user_id'] = (int) $user['id'];
    $_SESSION['password_fingerprint'] = hash('sha256', $user['password']);
    $_SESSION['last_seen'] = time();
    session_write_close();
    respond(200, publicUser($user));
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
        'SELECT id, username, email, password, verified, created FROM public."user" WHERE id = $1',
        [$userId]
    );
    if ($result === false) {
        respond(500, ['error' => 'Failed to look up account']);
    }
    $user = pg_fetch_assoc($result);
    if ($user === false || $user['verified'] !== 't'
        || !hash_equals(hash('sha256', $user['password']), $fingerprint)) {
        $_SESSION = [];
        session_write_close();
        respond(401, ['error' => 'Not authenticated']);
    }
    $_SESSION['last_seen'] = time();
    session_write_close();
    return $user;
}

function handleCurrentUser(): never
{
    respond(200, publicUser(currentSessionUser()));
}

function handleLogout(): never
{
    if (isset($_COOKIE['softerr_session'])) {
        startAuthSession();
        $_SESSION = [];
        session_destroy();
        $params = session_get_cookie_params();
        setcookie(session_name(), '', [
            'expires' => time() - 3600,
            'path' => $params['path'],
            'secure' => $params['secure'],
            'httponly' => $params['httponly'],
            'samesite' => $params['samesite'],
        ]);
    }
    respond(200, ['message' => 'Logged out']);
}
