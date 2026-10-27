<?php
declare(strict_types=1);

require_once __DIR__ . '/db.php';

function respond(int $statusCode, array $payload): never
{
    http_response_code($statusCode);
    echo json_encode($payload);
    exit;
}

function readJsonBody(int $maxBytes = 4096): ?array
{
    $rawBody = file_get_contents('php://input', false, null, 0, $maxBytes + 1);
    if ($rawBody === false || strlen($rawBody) > $maxBytes) {
        respond(413, ['error' => 'Request body is too large']);
    }

    $payload = json_decode($rawBody ?: '', true);
    return is_array($payload) ? $payload : null;
}

function apiRequestPath(string $basePath): ?string
{
    $path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
    if (!is_string($path)) {
        return null;
    }
    if ($path === $basePath) {
        return '/';
    }
    if (!str_starts_with($path, $basePath . '/')) {
        return null;
    }
    $subpath = rtrim(substr($path, strlen($basePath)), '/');
    return $subpath === '' ? '/' : $subpath;
}

function connectDb()
{
    [$conn, $error] = openDb();
    if ($conn === false) {
        respond(500, ['error' => $error]);
    }
    return $conn;
}

function connectQuizDb()
{
    [$conn, $error] = openQuizDb();
    if ($conn === false) {
        respond(500, ['error' => $error]);
    }
    return $conn;
}

