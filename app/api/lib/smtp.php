<?php
declare(strict_types=1);

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

