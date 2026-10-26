<?php
declare(strict_types=1);

function normalizeTimezoneName(?string $candidate): ?string
{
    $value = trim((string)($candidate ?? ''));
    if ($value === '') {
        return null;
    }
    try {
        new DateTimeZone($value);
        return $value;
    } catch (Exception $e) {
        return null;
    }
}

function detectUserTimezone(array $payload): ?string
{
    $candidates = [
        $_SERVER['HTTP_X_TIMEZONE'] ?? null,
        $_SERVER['HTTP_TIMEZONE'] ?? null,
        $_COOKIE['timezone'] ?? null,
        $payload['timezone'] ?? null,
    ];

    foreach ($candidates as $candidate) {
        $normalized = normalizeTimezoneName(is_string($candidate) ? $candidate : null);
        if ($normalized !== null) {
            return $normalized;
        }
    }

    return null;
}
