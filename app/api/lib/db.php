<?php
declare(strict_types=1);

function quotePgConnectionValue(string $value): string
{
    return "'" . str_replace(["\\", "'"], ["\\\\", "\\'"], $value) . "'";
}

function openDb(int $connectTimeoutSeconds = 3, ?string $databaseName = null): array
{
    if (!function_exists('pg_connect')) {
        return [false, 'PostgreSQL PHP extension is not installed'];
    }

    $host = getenv('DB_HOST') ?: '127.0.0.1';
    $port = getenv('DB_PORT') ?: '5432';
    $dbname = $databaseName ?? (getenv('DB_NAME') ?: 'auth');
    $user = getenv('DB_USER') ?: 'auth_api';
    $password = getenv('DB_PASSWORD') ?: '';

    if ($password === '') {
        return [false, 'DB_PASSWORD is not configured'];
    }

    $connectionString = sprintf(
        'host=%s port=%s dbname=%s user=%s password=%s connect_timeout=%d',
        quotePgConnectionValue((string)$host),
        quotePgConnectionValue((string)$port),
        quotePgConnectionValue((string)$dbname),
        quotePgConnectionValue((string)$user),
        quotePgConnectionValue((string)$password),
        $connectTimeoutSeconds
    );
    $conn = @pg_connect($connectionString);

    if ($conn === false) {
        return [false, 'Database connection failed'];
    }

    return [$conn, null];
}

function openQuizDb(): array
{
    return openDb(3, 'quiz');
}

function openMediaDb(): array
{
    return openDb(3, 'media');
}

