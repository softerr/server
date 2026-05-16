<?php
declare(strict_types=1);

header('Content-Type: application/json');

function respond(int $statusCode, array $payload): never
{
    http_response_code($statusCode);
    echo json_encode($payload);
    exit;
}

function connectDb()
{
    if (!function_exists('pg_connect')) {
        respond(500, ['error' => 'PostgreSQL PHP extension is not installed']);
    }

    $host = getenv('DB_HOST') ?: '127.0.0.1';
    $port = getenv('DB_PORT') ?: '5432';
    $dbname = getenv('DB_NAME') ?: 'auth';
    $user = getenv('DB_USER') ?: 'postgres';
    $password = getenv('DB_PASSWORD') ?: '';

    $conn = pg_connect(
        "host={$host} port={$port} dbname={$dbname} user={$user} password={$password}"
    );

    if ($conn === false) {
        respond(500, ['error' => 'Database connection failed']);
    }

    return $conn;
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

    if ($username === '' || $password === '' || $email === '') {
        respond(400, ['error' => 'username, password and email are required']);
    }
    if (strlen($username) > 100) {
        respond(400, ['error' => 'username must be at most 100 characters']);
    }
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        respond(400, ['error' => 'email is invalid']);
    }

    $passwordHash = password_hash($password, PASSWORD_DEFAULT);
    if ($passwordHash === false) {
        respond(500, ['error' => 'Failed to hash password']);
    }

    $db = connectDb();
    $result = @pg_query_params(
        $db,
        'INSERT INTO public."user" (username, password, email)
         VALUES ($1, $2, $3)
         RETURNING id, username, email, activated',
        [$username, $passwordHash, $email]
    );

    if ($result === false) {
        $errorMessage = pg_last_error($db);
        if (strpos($errorMessage, 'duplicate key value') !== false) {
            respond(409, ['error' => 'username or email already exists']);
        }
        respond(500, ['error' => 'Failed to create account']);
    }

    $user = pg_fetch_assoc($result);
    if ($user === false) {
        respond(500, ['error' => 'Failed to fetch created account']);
    }

    respond(201, [
        'id' => (int)$user['id'],
        'username' => $user['username'],
        'email' => $user['email'],
        'activated' => $user['activated'] === 't',
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
    respond(200, ['status' => 'ok', 'message' => 'API is working']);
}

if ($normalizedPath === '/auth/signup') {
    if ($method !== 'POST') {
        respond(405, ['error' => 'Method not allowed']);
    }
    handleSignup();
}

respond(404, ['error' => 'Not found']);
