<?php
declare(strict_types=1);

header('Content-Type: application/json');

require_once __DIR__ . '/lib/http.php';
require_once __DIR__ . '/lib/url.php';
require_once __DIR__ . '/lib/timezone.php';
require_once __DIR__ . '/lib/session.php';
require_once __DIR__ . '/handlers/signup.php';
require_once __DIR__ . '/handlers/resend.php';
require_once __DIR__ . '/handlers/verify.php';
require_once __DIR__ . '/handlers/login.php';
require_once __DIR__ . '/handlers/password_reset.php';

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$path = apiRequestPath('/api/auth');

if ($path === '/signup') {
    if ($method !== 'POST') {
        respond(405, ['error' => 'Method not allowed']);
    }
    handleSignup();
}

if ($path === '/verify') {
    if ($method !== 'GET') {
        respond(405, ['error' => 'Method not allowed']);
    }
    handleVerify();
}

if ($path === '/resend-verification') {
    if ($method !== 'POST') {
        respond(405, ['error' => 'Method not allowed']);
    }
    handleResendVerification();
}

if ($path === '/login') {
    if ($method !== 'POST') {
        respond(405, ['error' => 'Method not allowed']);
    }
    handleLogin();
}

if ($path === '/me') {
    if ($method !== 'GET') {
        respond(405, ['error' => 'Method not allowed']);
    }
    handleCurrentUser();
}

if ($path === '/logout') {
    if ($method !== 'POST') {
        respond(405, ['error' => 'Method not allowed']);
    }
    handleLogout();
}

if ($path === '/password-reset/request') {
    if ($method !== 'POST') {
        respond(405, ['error' => 'Method not allowed']);
    }
    handlePasswordResetRequest();
}

if ($path === '/password-reset/confirm') {
    if ($method !== 'POST') {
        respond(405, ['error' => 'Method not allowed']);
    }
    handlePasswordResetConfirm();
}

respond(404, ['error' => 'Not found']);
