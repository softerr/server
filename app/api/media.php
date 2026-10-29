<?php
declare(strict_types=1);

header('Content-Type: application/json');

require_once __DIR__ . '/lib/http.php';
require_once __DIR__ . '/lib/url.php';
require_once __DIR__ . '/lib/session.php';
require_once __DIR__ . '/handlers/images.php';
require_once __DIR__ . '/handlers/online_images.php';
require_once __DIR__ . '/handlers/media_groups.php';

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$path = apiRequestPath('/api/media');

if ($path === '/images') {
    if ($method === 'GET') handleListImages();
    if ($method === 'POST') handleUploadImage();
    respond(405, ['error' => 'Method not allowed']);
}

if ($path === '/online-search') {
    if ($method === 'GET') handleSearchOnlineImages();
    respond(405, ['error' => 'Method not allowed']);
}

if ($path === '/images/import') {
    if ($method === 'POST') handleImportOnlineImage();
    respond(405, ['error' => 'Method not allowed']);
}

if ($path === '/my-images') {
    if ($method === 'GET') handleListMyImages();
    respond(405, ['error' => 'Method not allowed']);
}

if ($path === '/shared-images') {
    if ($method === 'GET') handleListSharedImages();
    if ($method === 'POST') handleUploadSharedImage();
    respond(405, ['error' => 'Method not allowed']);
}

if ($path === '/groups') {
    if ($method === 'GET') handleListMediaGroups();
    if ($method === 'POST') handleCreateMediaGroup();
    respond(405, ['error' => 'Method not allowed']);
}

if (is_string($path) && preg_match('#^/groups/([1-9][0-9]*)$#', $path, $match)) {
    $groupId = filter_var($match[1], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    if ($groupId === false) respond(404, ['error' => 'Not found']);
    if ($method === 'PATCH') handleRenameMediaGroup($groupId);
    if ($method === 'DELETE') handleDeleteMediaGroup($groupId);
    respond(405, ['error' => 'Method not allowed']);
}

if (is_string($path) && preg_match('#^/groups/([1-9][0-9]*)/images$#', $path, $match)) {
    $groupId = filter_var($match[1], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    if ($groupId === false) respond(404, ['error' => 'Not found']);
    if ($method === 'POST') handleUploadSharedImage($groupId);
    respond(405, ['error' => 'Method not allowed']);
}

if (is_string($path) && preg_match('#^/images/([1-9][0-9]*)/group$#', $path, $match)) {
    $imageId = filter_var($match[1], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    if ($imageId === false) respond(404, ['error' => 'Not found']);
    if ($method === 'PATCH') handleMoveSharedImage($imageId);
    respond(405, ['error' => 'Method not allowed']);
}

if (is_string($path) && preg_match('#^/images/([1-9][0-9]*)/publish$#', $path, $match)) {
    $imageId = filter_var($match[1], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    if ($imageId === false) respond(404, ['error' => 'Not found']);
    if ($method === 'POST') handlePublishImage($imageId);
    respond(405, ['error' => 'Method not allowed']);
}

if (is_string($path) && preg_match('#^/images/([1-9][0-9]*)$#', $path, $match)) {
    $imageId = filter_var($match[1], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    if ($imageId === false) respond(404, ['error' => 'Not found']);
    if ($method === 'GET') handleGetImage($imageId);
    if ($method === 'PATCH') handleRenameImage($imageId);
    if ($method === 'DELETE') handleDeleteImage($imageId);
    respond(405, ['error' => 'Method not allowed']);
}

respond(404, ['error' => 'Not found']);
