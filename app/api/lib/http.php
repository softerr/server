<?php
declare(strict_types=1);

require_once __DIR__ . '/db.php';

function respond(int $statusCode, array $payload): never
{
    http_response_code($statusCode);
    echo json_encode($payload);
    exit;
}

function connectDb()
{
    [$conn, $error] = openDb();
    if ($conn === false) {
        respond(500, ['error' => $error]);
    }
    return $conn;
}

