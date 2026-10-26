<?php
declare(strict_types=1);

require_once __DIR__ . '/db.php';

function respond(int $statusCode, array $payload): never
{
    http_response_code($statusCode);
    echo json_encode($payload);
    exit;
}

function readJsonBody(): ?array
{
    $rawBody = file_get_contents('php://input', false, null, 0, 4097);
    if ($rawBody === false || strlen($rawBody) > 4096) {
        respond(413, ['error' => 'Request body is too large']);
    }

    $payload = json_decode($rawBody ?: '', true);
    return is_array($payload) ? $payload : null;
}

function connectDb()
{
    [$conn, $error] = openDb();
    if ($conn === false) {
        respond(500, ['error' => $error]);
    }
    return $conn;
}

