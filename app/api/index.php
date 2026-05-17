<?php
declare(strict_types=1);

header('Content-Type: application/json');

function respond(int $statusCode, array $payload): never
{
    http_response_code($statusCode);
    echo json_encode($payload);
    exit;
}

function appBaseUrl(): string
{
    $explicit = trim((string)(getenv('APP_BASE_URL') ?: ''));
    if ($explicit !== '') {
        return rtrim($explicit, '/');
    }

    $https = $_SERVER['HTTPS'] ?? '';
    $scheme = (!empty($https) && strtolower((string)$https) !== 'off') ? 'https' : 'http';
    $host = (string)($_SERVER['HTTP_HOST'] ?? 'localhost');
    return $scheme . '://' . $host;
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

function sendVerificationEmail(string $email, string $username, string $token, string $expires): bool
{
    $verifyUrl = appBaseUrl() . '/api/auth/verify?token=' . rawurlencode($token);
    $subject = 'Verify your account';
    $body = "Hello {$username},\n\n"
        . "Please verify your account by opening this link:\n"
        . "{$verifyUrl}\n\n"
        . "This link expires at: {$expires}\n";

    $mailFrom = trim((string)(getenv('MAIL_FROM') ?: 'no-reply@localhost'));
    if (sendViaSmtp($email, $subject, $body, $mailFrom)) {
        return true;
    }

    if (!function_exists('mail')) {
        return false;
    }

    $headers = [
        "From: {$mailFrom}",
        'Content-Type: text/plain; charset=UTF-8',
    ];

    return mail($email, $subject, $body, implode("\r\n", $headers));
}

function connectDb()
{
    if (!function_exists('pg_connect')) {
        respond(500, ['error' => 'PostgreSQL PHP extension is not installed']);
    }

    $host = getenv('DB_HOST') ?: '127.0.0.1';
    $port = getenv('DB_PORT') ?: '5432';
    $dbname = getenv('DB_NAME') ?: 'auth';
    $user = getenv('DB_USER') ?: 'auth_api';
    $password = getenv('DB_PASSWORD') ?: '';

    if ($password === '') {
        respond(500, ['error' => 'DB_PASSWORD is not configured']);
    }

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
        if (strpos($errorMessage, 'duplicate key value') !== false) {
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
        'INSERT INTO public.user_token (user_id, type)
         VALUES ($1, $2)
         RETURNING hash, expires',
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

    if (!sendVerificationEmail($user['email'], $user['username'], $tokenRow['hash'], $tokenRow['expires'])) {
        @pg_query($db, 'ROLLBACK');
        respond(500, ['error' => 'Failed to send verification email']);
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
    ]);
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
        'DELETE FROM public.user_token WHERE id = $1',
        [$tokenRow['id']]
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
    respond(200, ['status' => 'ok', 'message' => 'API is working']);
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

respond(404, ['error' => 'Not found']);
