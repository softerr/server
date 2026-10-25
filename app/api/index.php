<?php
declare(strict_types=1);

header('Content-Type: application/json');

function respond(int $statusCode, array $payload): never
{
    http_response_code($statusCode);
    echo json_encode($payload);
    exit;
}

require_once __DIR__ . '/mail.php';

function openDb(): array
{
    if (!function_exists('pg_connect')) {
        return [false, 'PostgreSQL PHP extension is not installed'];
    }

    $host = getenv('DB_HOST') ?: '127.0.0.1';
    $port = getenv('DB_PORT') ?: '5432';
    $dbname = getenv('DB_NAME') ?: 'auth';
    $user = getenv('DB_USER') ?: 'auth_api';
    $password = getenv('DB_PASSWORD') ?: '';

    if ($password === '') {
        return [false, 'DB_PASSWORD is not configured'];
    }

    $connectionString = sprintf(
        'host=%s port=%s dbname=%s user=%s password=%s connect_timeout=3',
        quotePgConnectionValue((string)$host),
        quotePgConnectionValue((string)$port),
        quotePgConnectionValue((string)$dbname),
        quotePgConnectionValue((string)$user),
        quotePgConnectionValue((string)$password)
    );
    $conn = @pg_connect($connectionString);

    if ($conn === false) {
        return [false, 'Database connection failed'];
    }

    return [$conn, null];
}

function connectDb()
{
    [$conn, $error] = openDb();
    if ($conn === false) {
        respond(500, ['error' => $error]);
    }
    return $conn;
}

function handleReadiness(): never
{
    if (appBaseUrl() === null) {
        respond(503, ['status' => 'unavailable', 'error' => 'Verification email is not configured']);
    }

    [$db, $error] = openDb();
    if ($db === false) {
        respond(503, ['status' => 'unavailable', 'error' => $error]);
    }

    $schema = @pg_query($db, 'SELECT u.id, u.email, t.hash, t.email_attempted_at, o.token_id, o.available_at
        FROM public."user" u, public.user_token t, public.verification_email_outbox o
        LIMIT 0');
    if ($schema === false) {
        respond(503, ['status' => 'unavailable', 'error' => 'Database schema is not ready']);
    }

    respond(200, ['status' => 'ok', 'message' => 'API is ready']);
}

function handleSignup(): never
{
    $rawBody = file_get_contents('php://input');
    $payload = json_decode($rawBody ?: '', true);
    if (!is_array($payload)) {
        respond(400, ['error' => 'Invalid JSON body']);
    }

    $username = trim((string)($payload['username'] ?? ''));
    $password = (string)($payload['password'] ?? '');
    $email = strtolower(trim((string)($payload['email'] ?? '')));
    $timezone = detectUserTimezone($payload);

    if ($username === '' || $password === '' || $email === '') {
        respond(400, ['error' => 'username, password and email are required']);
    }
    if (strlen($username) > 100) {
        respond(400, ['error' => 'username must be at most 100 characters']);
    }
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        respond(400, ['error' => 'email is invalid']);
    }
    if (appBaseUrl() === null) {
        respond(503, ['error' => 'Verification email is not configured']);
    }

    $passwordHash = password_hash($password, PASSWORD_DEFAULT);
    if ($passwordHash === false) {
        respond(500, ['error' => 'Failed to hash password']);
    }

    $db = connectDb();

    $duplicateCheckResult = @pg_query_params(
        $db,
        'SELECT 1
         FROM public."user"
         WHERE username = $1 OR email = $2
         LIMIT 1',
        [$username, $email]
    );
    if ($duplicateCheckResult === false) {
        respond(500, ['error' => 'Failed to validate account uniqueness']);
    }
    if (pg_fetch_assoc($duplicateCheckResult) !== false) {
        respond(409, ['error' => 'username or email already exists']);
    }

    if (@pg_query($db, 'BEGIN') === false) {
        respond(500, ['error' => 'Failed to start transaction']);
    }

    $result = @pg_query_params(
        $db,
        'INSERT INTO public."user" (username, password, email)
         VALUES ($1, $2, $3)
         RETURNING id, username, email, verified, created',
        [$username, $passwordHash, $email]
    );

    if ($result === false) {
        @pg_query($db, 'ROLLBACK');
        $errorMessage = pg_last_error($db);
        $normalizedError = strtolower($errorMessage);
        if (
            strpos($normalizedError, 'duplicate key value') !== false
            || strpos($normalizedError, 'unique constraint') !== false
            || strpos($normalizedError, '23505') !== false
        ) {
            respond(409, ['error' => 'username or email already exists']);
        }
        respond(500, ['error' => 'Failed to create account']);
    }

    $user = pg_fetch_assoc($result);
    if ($user === false) {
        @pg_query($db, 'ROLLBACK');
        respond(500, ['error' => 'Failed to fetch created account']);
    }

    $tokenResult = @pg_query_params(
        $db,
        'INSERT INTO public.user_token (user_id, type, email_attempted_at)
         VALUES ($1, $2, CURRENT_TIMESTAMP)
         RETURNING id',
        [$user['id'], 'verify']
    );
    if ($tokenResult === false) {
        @pg_query($db, 'ROLLBACK');
        respond(500, ['error' => 'Failed to create verification token']);
    }

    $tokenRow = pg_fetch_assoc($tokenResult);
    if ($tokenRow === false) {
        @pg_query($db, 'ROLLBACK');
        respond(500, ['error' => 'Failed to fetch verification token']);
    }

    $queueResult = @pg_query_params(
        $db,
        'INSERT INTO public.verification_email_outbox (token_id, timezone) VALUES ($1, $2)',
        [$tokenRow['id'], $timezone]
    );
    if ($queueResult === false) {
        @pg_query($db, 'ROLLBACK');
        respond(500, ['error' => 'Failed to queue verification email']);
    }

    if (@pg_query($db, 'COMMIT') === false) {
        @pg_query($db, 'ROLLBACK');
        respond(500, ['error' => 'Failed to finalize account creation']);
    }

    respond(201, [
        'id' => (int)$user['id'],
        'username' => $user['username'],
        'email' => $user['email'],
        'verified' => $user['verified'] === 't',
        'created' => $user['created'],
        'verification_email_queued' => true,
    ]);
}

function handleResendVerification(): never
{
    $rawBody = file_get_contents('php://input');
    $payload = json_decode($rawBody ?: '', true);
    if (!is_array($payload) || !is_string($payload['email'] ?? null)) {
        respond(400, ['error' => 'A valid email is required']);
    }

    $email = strtolower(trim($payload['email']));
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        respond(400, ['error' => 'A valid email is required']);
    }
    if (appBaseUrl() === null) {
        respond(503, ['error' => 'Verification email is not configured']);
    }
    $timezone = detectUserTimezone($payload);
    $accepted = ['message' => 'Verification email request accepted'];
    $db = connectDb();

    if (@pg_query($db, 'BEGIN') === false) {
        respond(500, ['error' => 'Failed to start transaction']);
    }

    $userResult = @pg_query_params(
        $db,
        'SELECT id, username, email, verified FROM public."user" WHERE email = $1 FOR UPDATE',
        [$email]
    );
    if ($userResult === false) {
        @pg_query($db, 'ROLLBACK');
        respond(500, ['error' => 'Failed to look up account']);
    }

    $user = pg_fetch_assoc($userResult);
    if ($user === false || $user['verified'] === 't') {
        if (@pg_query($db, 'COMMIT') === false) {
            respond(500, ['error' => 'Failed to finalize verification email request']);
        }
        respond(202, $accepted);
    }

    $tokenResult = @pg_query_params(
        $db,
        'SELECT id, expires,
                expires > CURRENT_TIMESTAMP + INTERVAL \'10 minutes\' AS reusable,
                email_attempted_at > CURRENT_TIMESTAMP - INTERVAL \'1 minute\' AS recent_attempt
         FROM public.user_token
         WHERE user_id = $1 AND type = $2
         ORDER BY id DESC LIMIT 1',
        [$user['id'], 'verify']
    );
    if ($tokenResult === false) {
        @pg_query($db, 'ROLLBACK');
        respond(500, ['error' => 'Failed to look up verification token']);
    }

    $token = pg_fetch_assoc($tokenResult);
    if ($token !== false && $token['recent_attempt'] === 't') {
        if (@pg_query($db, 'COMMIT') === false) {
            respond(500, ['error' => 'Failed to finalize verification email request']);
        }
        respond(202, $accepted);
    }

    if ($token !== false && $token['reusable'] === 't') {
        $claimResult = @pg_query_params(
            $db,
            'UPDATE public.user_token SET email_attempted_at = CURRENT_TIMESTAMP
             WHERE id = $1 RETURNING id',
            [$token['id']]
        );
    } else {
        $deleteResult = @pg_query_params(
            $db,
            'DELETE FROM public.user_token WHERE user_id = $1 AND type = $2',
            [$user['id'], 'verify']
        );
        if ($deleteResult === false) {
            @pg_query($db, 'ROLLBACK');
            respond(500, ['error' => 'Failed to replace verification token']);
        }
        $claimResult = @pg_query_params(
            $db,
            'INSERT INTO public.user_token (user_id, type, email_attempted_at)
             VALUES ($1, $2, CURRENT_TIMESTAMP) RETURNING id',
            [$user['id'], 'verify']
        );
    }
    if ($claimResult === false || ($claimedToken = pg_fetch_assoc($claimResult)) === false) {
        @pg_query($db, 'ROLLBACK');
        respond(500, ['error' => 'Failed to prepare verification email']);
    }

    $queueResult = @pg_query_params(
        $db,
        'INSERT INTO public.verification_email_outbox (token_id, timezone)
         VALUES ($1, $2)
         ON CONFLICT (token_id) DO UPDATE
         SET timezone = EXCLUDED.timezone, available_at = CURRENT_TIMESTAMP, attempts = 0',
        [$claimedToken['id'], $timezone]
    );
    if ($queueResult === false) {
        @pg_query($db, 'ROLLBACK');
        respond(500, ['error' => 'Failed to queue verification email']);
    }

    if (@pg_query($db, 'COMMIT') === false) {
        @pg_query($db, 'ROLLBACK');
        respond(500, ['error' => 'Failed to finalize verification email request']);
    }

    respond(202, $accepted);
}

function handleVerify(): never
{
    $token = trim((string)($_GET['token'] ?? ''));
    if ($token === '' || !preg_match('/^[a-f0-9]{64}$/i', $token)) {
        respond(400, ['error' => 'Invalid verification token']);
    }

    $db = connectDb();

    if (@pg_query($db, 'BEGIN') === false) {
        respond(500, ['error' => 'Failed to start transaction']);
    }

    $tokenResult = @pg_query_params(
        $db,
        'SELECT id, user_id
         FROM public.user_token
         WHERE hash = $1
           AND type = $2
           AND expires > CURRENT_TIMESTAMP
         LIMIT 1',
        [$token, 'verify']
    );
    if ($tokenResult === false) {
        @pg_query($db, 'ROLLBACK');
        respond(500, ['error' => 'Failed to validate verification token']);
    }

    $tokenRow = pg_fetch_assoc($tokenResult);
    if ($tokenRow === false) {
        @pg_query($db, 'ROLLBACK');
        respond(400, ['error' => 'Verification token is invalid or expired']);
    }

    $verifyResult = @pg_query_params(
        $db,
        'UPDATE public."user"
         SET verified = TRUE
         WHERE id = $1
         RETURNING id, username, email, verified, created',
        [$tokenRow['user_id']]
    );
    if ($verifyResult === false) {
        @pg_query($db, 'ROLLBACK');
        respond(500, ['error' => 'Failed to verify account']);
    }

    $user = pg_fetch_assoc($verifyResult);
    if ($user === false) {
        @pg_query($db, 'ROLLBACK');
        respond(500, ['error' => 'Failed to fetch verified account']);
    }

    $deleteResult = @pg_query_params(
        $db,
        'DELETE FROM public.user_token WHERE user_id = $1 AND type = $2',
        [$tokenRow['user_id'], 'verify']
    );
    if ($deleteResult === false) {
        @pg_query($db, 'ROLLBACK');
        respond(500, ['error' => 'Failed to finalize verification']);
    }

    if (@pg_query($db, 'COMMIT') === false) {
        @pg_query($db, 'ROLLBACK');
        respond(500, ['error' => 'Failed to commit verification']);
    }

    respond(200, [
        'id' => (int)$user['id'],
        'username' => $user['username'],
        'email' => $user['email'],
        'verified' => $user['verified'] === 't',
        'created' => $user['created'],
    ]);
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$uriPath = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$path = preg_replace('#^/api#', '', $uriPath);
$path = $path === '' ? '/' : $path;
$normalizedPath = rtrim($path, '/');
$normalizedPath = $normalizedPath === '' ? '/' : $normalizedPath;

if ($normalizedPath === '/') {
    if ($method !== 'GET') {
        respond(405, ['error' => 'Method not allowed']);
    }
    handleReadiness();
}

if ($normalizedPath === '/auth/signup') {
    if ($method !== 'POST') {
        respond(405, ['error' => 'Method not allowed']);
    }
    handleSignup();
}

if ($normalizedPath === '/auth/verify') {
    if ($method !== 'GET') {
        respond(405, ['error' => 'Method not allowed']);
    }
    handleVerify();
}

if ($normalizedPath === '/auth/resend-verification') {
    if ($method !== 'POST') {
        respond(405, ['error' => 'Method not allowed']);
    }
    handleResendVerification();
}

respond(404, ['error' => 'Not found']);
