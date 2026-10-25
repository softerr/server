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
        $payload['timezone'] ?? null,
        $_SERVER['HTTP_X_TIMEZONE'] ?? null,
        $_SERVER['HTTP_TIMEZONE'] ?? null,
        $_COOKIE['timezone'] ?? null,
    ];

    foreach ($candidates as $candidate) {
        $normalized = normalizeTimezoneName(is_string($candidate) ? $candidate : null);
        if ($normalized !== null) {
            return $normalized;
        }
    }

    return null;
}

function smtpReadLine($socket): string|false
{
    $line = fgets($socket, 515);
    if ($line === false) {
        return false;
    }
    return rtrim($line, "\r\n");
}

function smtpReadResponse($socket): array|false
{
    $lines = [];
    while (true) {
        $line = smtpReadLine($socket);
        if ($line === false) {
            return false;
        }
        $lines[] = $line;
        if (preg_match('/^\d{3} /', $line) === 1) {
            break;
        }
    }

    $last = $lines[count($lines) - 1];
    $code = (int)substr($last, 0, 3);
    return ['code' => $code, 'message' => implode("\n", $lines)];
}

function smtpExpect($socket, array $allowedCodes, string $stage): bool
{
    $response = smtpReadResponse($socket);
    if ($response === false) {
        error_log("SMTP {$stage} failed: no response");
        return false;
    }
    if (!in_array($response['code'], $allowedCodes, true)) {
        error_log("SMTP {$stage} failed: " . $response['message']);
        return false;
    }
    return true;
}

function smtpCommand($socket, string $command, array $allowedCodes, string $stage): bool
{
    if (fwrite($socket, $command . "\r\n") === false) {
        error_log("SMTP {$stage} failed: write error");
        return false;
    }
    return smtpExpect($socket, $allowedCodes, $stage);
}

function sendViaSmtp(string $email, string $subject, string $body, string $mailFrom): bool
{
    $host = trim((string)(getenv('SMTP_HOST') ?: ''));
    if ($host === '') {
        return false;
    }

    $portRaw = getenv('SMTP_PORT');
    $port = (is_string($portRaw) && $portRaw !== '') ? (int)$portRaw : 587;
    if ($port < 1 || $port > 65535) {
        error_log('SMTP configuration error: SMTP_PORT is invalid');
        return false;
    }

    $encryption = strtolower(trim((string)(getenv('SMTP_ENCRYPTION') ?: 'tls')));
    if ($encryption === '') {
        $encryption = 'tls';
    }
    if (!in_array($encryption, ['tls', 'ssl', 'none'], true)) {
        error_log('SMTP configuration error: SMTP_ENCRYPTION must be tls, ssl, or none');
        return false;
    }

    $username = trim((string)(getenv('SMTP_USERNAME') ?: ''));
    $password = (string)(getenv('SMTP_PASSWORD') ?: '');

    $transport = ($encryption === 'ssl') ? 'ssl://' : '';
    $target = $transport . $host . ':' . $port;

    $socket = @stream_socket_client($target, $errno, $errstr, 15, STREAM_CLIENT_CONNECT);
    if ($socket === false) {
        error_log("SMTP connect failed: {$errstr} ({$errno})");
        return false;
    }
    stream_set_timeout($socket, 15);

    if (!smtpExpect($socket, [220], 'greeting')) {
        fclose($socket);
        return false;
    }

    $ehloHost = trim((string)($_SERVER['SERVER_NAME'] ?? 'localhost'));
    if ($ehloHost === '') {
        $ehloHost = 'localhost';
    }

    if (!smtpCommand($socket, "EHLO {$ehloHost}", [250], 'EHLO')) {
        if (!smtpCommand($socket, "HELO {$ehloHost}", [250], 'HELO')) {
            fclose($socket);
            return false;
        }
    }

    if ($encryption === 'tls') {
        if (!smtpCommand($socket, 'STARTTLS', [220], 'STARTTLS')) {
            fclose($socket);
            return false;
        }
        $tlsOk = stream_socket_enable_crypto($socket, true, STREAM_CRYPTO_METHOD_TLS_CLIENT);
        if ($tlsOk !== true) {
            error_log('SMTP STARTTLS failed to enable TLS crypto');
            fclose($socket);
            return false;
        }
        if (!smtpCommand($socket, "EHLO {$ehloHost}", [250], 'EHLO after STARTTLS')) {
            fclose($socket);
            return false;
        }
    }

    if ($username !== '') {
        if ($password === '') {
            error_log('SMTP configuration error: SMTP_PASSWORD is required when SMTP_USERNAME is set');
            fclose($socket);
            return false;
        }
        if (!smtpCommand($socket, 'AUTH LOGIN', [334], 'AUTH LOGIN')) {
            fclose($socket);
            return false;
        }
        if (!smtpCommand($socket, base64_encode($username), [334], 'AUTH username')) {
            fclose($socket);
            return false;
        }
        if (!smtpCommand($socket, base64_encode($password), [235], 'AUTH password')) {
            fclose($socket);
            return false;
        }
    }

    if (!smtpCommand($socket, 'MAIL FROM:<' . $mailFrom . '>', [250], 'MAIL FROM')) {
        fclose($socket);
        return false;
    }
    if (!smtpCommand($socket, 'RCPT TO:<' . $email . '>', [250, 251], 'RCPT TO')) {
        fclose($socket);
        return false;
    }
    if (!smtpCommand($socket, 'DATA', [354], 'DATA')) {
        fclose($socket);
        return false;
    }

    $headers = [
        'From: ' . $mailFrom,
        'To: ' . $email,
        'Subject: ' . $subject,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8',
    ];

    $normalizedBody = str_replace(["\r\n", "\r"], "\n", $body);
    $bodyLines = explode("\n", $normalizedBody);
    foreach ($bodyLines as &$line) {
        if ($line !== '' && $line[0] === '.') {
            $line = '.' . $line;
        }
    }
    unset($line);

    $message = implode("\r\n", $headers)
        . "\r\n\r\n"
        . implode("\r\n", $bodyLines)
        . "\r\n.\r\n";

    if (fwrite($socket, $message) === false) {
        error_log('SMTP DATA write failed');
        fclose($socket);
        return false;
    }

    if (!smtpExpect($socket, [250], 'message acceptance')) {
        fclose($socket);
        return false;
    }

    smtpCommand($socket, 'QUIT', [221], 'QUIT');
    fclose($socket);
    return true;
}

function sendVerificationEmail(string $email, string $username, string $token, string $expires, ?string $userTimezone = null): bool
{
    $baseUrl = appBaseUrl();
    if ($baseUrl === null) {
        return false;
    }

    $formattedExpires = $expires;
    try {
        $trimmedExpires = trim($expires);
        if (preg_match('/(Z|[+-]\d{2}(:?\d{2})?|[A-Za-z_\/]+)$/', $trimmedExpires) === 1) {
            $expiresAt = new DateTimeImmutable($trimmedExpires);
        } else {
            // PostgreSQL text value without timezone is treated as UTC.
            $expiresAt = new DateTimeImmutable($trimmedExpires, new DateTimeZone('UTC'));
        }

        $timezoneName = trim((string)($userTimezone ?? ''));
        if ($timezoneName !== '') {
            try {
                $expiresAt = $expiresAt->setTimezone(new DateTimeZone($timezoneName));
            } catch (Exception $e) {
                // Ignore invalid timezone and keep parsed timezone.
            }
        }
        $formattedExpires = $expiresAt->format('Y-m-d H:i:s T');
    } catch (Exception $e) {
        // Keep original value when parsing fails.
    }

    $verifyUrl = $baseUrl . '/api/auth/verify?token=' . rawurlencode($token);
    $subject = 'Verify your account';
    $body = "Hello {$username},\n\n"
        . "Please verify your account by opening this link:\n"
        . "{$verifyUrl}\n\n"
        . "This link expires at: {$formattedExpires}\n";

    $mailFrom = trim((string)(getenv('MAIL_FROM') ?: 'no-reply@localhost'));
    if (trim((string)(getenv('SMTP_HOST') ?: '')) !== '') {
        return sendViaSmtp($email, $subject, $body, $mailFrom);
    }

    if (!function_exists('mail')) {
        error_log('PHP mail() is unavailable and SMTP_HOST is not configured');
        return false;
    }

    $headers = [
        "From: {$mailFrom}",
        'Content-Type: text/plain; charset=UTF-8',
    ];

    $accepted = mail($email, $subject, $body, implode("\r\n", $headers));
    if (!$accepted) {
        error_log('PHP mail() failed to accept verification email');
    }
    return $accepted;
}

function quotePgConnectionValue(string $value): string
{
    return "'" . str_replace(["\\", "'"], ["\\\\", "\\'"], $value) . "'";
}

