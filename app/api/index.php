<?php
declare(strict_types=1);

header('Content-Type: application/json');

require_once __DIR__ . '/lib/http.php';
require_once __DIR__ . '/lib/url.php';
require_once __DIR__ . '/handlers/health.php';

if (apiRequestPath('/api') !== '/') {
    respond(404, ['error' => 'Not found']);
}
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    respond(405, ['error' => 'Method not allowed']);
}
handleReadiness();
