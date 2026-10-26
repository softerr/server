<?php
declare(strict_types=1);

function appBaseUrl(): ?string
{
    $url = trim((string)(getenv('APP_BASE_URL') ?: ''));
    $parts = parse_url($url);
    $scheme = strtolower((string)($parts['scheme'] ?? ''));
    $host = strtolower((string)($parts['host'] ?? ''));
    if (
        $url === ''
        || filter_var($url, FILTER_VALIDATE_URL) === false
        || $parts === false
        || !in_array($scheme, ['http', 'https'], true)
        || $host === ''
        || ($scheme === 'http' && !in_array($host, ['localhost', '127.0.0.1'], true))
        || isset($parts['user'])
        || isset($parts['pass'])
        || isset($parts['query'])
        || isset($parts['fragment'])
        || !in_array($parts['path'] ?? '', ['', '/'], true)
    ) {
        error_log('APP_BASE_URL must be an HTTPS origin or a loopback HTTP origin');
        return null;
    }

    return rtrim($url, '/');
}
