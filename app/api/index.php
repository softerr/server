<?php
declare(strict_types=1);

header('Content-Type: application/json');

require_once __DIR__ . '/lib/http.php';
require_once __DIR__ . '/lib/url.php';
require_once __DIR__ . '/lib/timezone.php';
require_once __DIR__ . '/handlers/health.php';
require_once __DIR__ . '/handlers/signup.php';
require_once __DIR__ . '/handlers/resend.php';
require_once __DIR__ . '/handlers/verify.php';
require_once __DIR__ . '/handlers/login.php';
require_once __DIR__ . '/handlers/password_reset.php';

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
    handleReadiness();
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

if ($normalizedPath === '/auth/resend-verification') {
    if ($method !== 'POST') {
        respond(405, ['error' => 'Method not allowed']);
    }
    handleResendVerification();
}

if ($normalizedPath === '/auth/login') {
    if ($method !== 'POST') {
        respond(405, ['error' => 'Method not allowed']);
    }
    handleLogin();
}

if ($normalizedPath === '/auth/me') {
    if ($method !== 'GET') {
        respond(405, ['error' => 'Method not allowed']);
    }
    handleCurrentUser();
}

if ($normalizedPath === '/auth/logout') {
    if ($method !== 'POST') {
        respond(405, ['error' => 'Method not allowed']);
    }
    handleLogout();
}

if ($normalizedPath === '/auth/password-reset/request') {
    if ($method !== 'POST') {
        respond(405, ['error' => 'Method not allowed']);
    }
    handlePasswordResetRequest();
}

if ($normalizedPath === '/auth/password-reset/confirm') {
    if ($method !== 'POST') {
        respond(405, ['error' => 'Method not allowed']);
    }
    handlePasswordResetConfirm();
}

respond(404, ['error' => 'Not found']);
