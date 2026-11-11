<?php
declare(strict_types=1);

header('Content-Type: application/json');

require_once __DIR__ . '/lib/http.php';
require_once __DIR__ . '/lib/backup_lock.php';
requireBackupCaptureReadLock();
require_once __DIR__ . '/lib/url.php';
require_once __DIR__ . '/handlers/health.php';

$path = apiRequestPath('/api');
if ($path === null) {
    respond(404, ['error' => 'Not found']);
}
$component = null;
if ($path !== '/') {
    if (!preg_match('#^/health/([a-z][a-z0-9_]*)$#D', $path, $match)) {
        respond(404, ['error' => 'Not found']);
    }
    $component = $match[1];
}
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    respond(405, ['error' => 'Method not allowed']);
}
handleReadiness($component);
