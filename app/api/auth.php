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
require_once __DIR__ . '/handlers/users.php';
require_once __DIR__ . '/handlers/backups.php';
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

if ($path === '/users') {
    if ($method !== 'GET') {
        respond(405, ['error' => 'Method not allowed']);
    }
    handleListUsers();
}

if ($path === '/backups') {
    if ($method !== 'GET') respond(405, ['error' => 'Method not allowed']);
    handleListBackups();
}

if (is_string($path) && preg_match('#^/backups/(\d{8}T\d{6}Z)/download$#D', $path, $backupMatch)) {
    if ($method !== 'GET') respond(405, ['error' => 'Method not allowed']);
    handleDownloadBackup($backupMatch[1]);
}

if (is_string($path) && preg_match('#^/users/([1-9][0-9]*)/role$#', $path, $userMatch)) {
    $userId = filter_var($userMatch[1], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    if ($userId === false) {
        respond(404, ['error' => 'Not found']);
    }
    if ($method !== 'PATCH') {
        respond(405, ['error' => 'Method not allowed']);
    }
    handleUpdateUserRole($userId);
}

if (is_string($path) && preg_match('#^/users/([1-9][0-9]*)/approve$#', $path, $userMatch)) {
    $userId = filter_var($userMatch[1], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    if ($userId === false) {
        respond(404, ['error' => 'Not found']);
    }
    if ($method !== 'POST') {
        respond(405, ['error' => 'Method not allowed']);
    }
    handleApproveUser($userId);
}

if (is_string($path) && preg_match('#^/users/([1-9][0-9]*)$#', $path, $userMatch)) {
    $userId = filter_var($userMatch[1], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    if ($userId === false) {
        respond(404, ['error' => 'Not found']);
    }
    if ($method !== 'DELETE') {
        respond(405, ['error' => 'Method not allowed']);
    }
    handleDeleteUser($userId);
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
