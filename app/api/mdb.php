<?php
declare(strict_types=1);

header('Content-Type: application/json');
header('Cache-Control: private, no-store');

require_once __DIR__ . '/lib/http.php';
require_once __DIR__ . '/lib/url.php';
require_once __DIR__ . '/lib/session.php';
require_once __DIR__ . '/apps/mdb/databases.php';
require_once __DIR__ . '/apps/mdb/csv_import.php';

$path = apiRequestPath('/api/mdb');
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$authUser = appAccessUser(currentSessionUser(), 'mdb', $method !== 'GET');
if ($path === '/databases') {
    $user = $authUser;
    if ($method === 'GET') handleListMdbDatabases($user);
    if ($method === 'POST') handleCreateMdbDatabase($user);
    respond(405, ['error' => 'Method not allowed']);
}
if (is_string($path) && preg_match('#^/databases/([1-9][0-9]*)$#D', $path, $match)) {
    $id = filter_var($match[1], FILTER_VALIDATE_INT);
    if ($id === false) respond(404, ['error' => 'Not found']);
    if ($method === 'GET') handleGetMdbDatabase($authUser, $id);
    respond(405, ['error' => 'Method not allowed']);
}
if (is_string($path) && preg_match('#^/databases/([1-9][0-9]*)/(columns|rows)$#D', $path, $match)) {
    $id = filter_var($match[1], FILTER_VALIDATE_INT);
    if ($id === false) respond(404, ['error' => 'Not found']);
    if ($method === 'POST') {
        $user = $authUser;
        if ($match[2] === 'columns') handleAddMdbColumn($user, $id);
        handleAddMdbRow($user, $id);
    }
    respond(405, ['error' => 'Method not allowed']);
}
if (is_string($path) && preg_match('#^/databases/([1-9][0-9]*)/rows/batch$#D', $path, $match)) {
    $id = filter_var($match[1], FILTER_VALIDATE_INT);
    if ($id === false) respond(404, ['error' => 'Not found']);
    if ($method === 'POST') handleAddMdbRows($authUser, $id);
    respond(405, ['error' => 'Method not allowed']);
}
if (is_string($path) && preg_match('#^/databases/([1-9][0-9]*)/(columns|rows)/order$#D', $path, $match)) {
    $id = filter_var($match[1], FILTER_VALIDATE_INT);
    if ($id === false) respond(404, ['error' => 'Not found']);
    if ($method === 'PUT') handleReorderMdbItems($authUser, $id, $match[2]);
    respond(405, ['error' => 'Method not allowed']);
}
if (is_string($path) && preg_match('#^/databases/([1-9][0-9]*)/import(?:/(preview))?$#D', $path, $match)) {
    $id = filter_var($match[1], FILTER_VALIDATE_INT);
    if ($id === false) respond(404, ['error' => 'Not found']);
    if ($method === 'POST') {
        $user = $authUser;
        if (($match[2] ?? '') === 'preview') handlePreviewMdbCsv($user, $id);
        handleImportMdbCsv($user, $id);
    }
    respond(405, ['error' => 'Method not allowed']);
}
if (is_string($path) && preg_match('#^/databases/([1-9][0-9]*)/columns/([1-9][0-9]*)$#D', $path, $match)) {
    $databaseId = filter_var($match[1], FILTER_VALIDATE_INT);
    $columnId = filter_var($match[2], FILTER_VALIDATE_INT);
    if ($databaseId === false || $columnId === false) respond(404, ['error' => 'Not found']);
    if ($method === 'PATCH') handleUpdateMdbColumn($authUser, $databaseId, $columnId);
    if ($method === 'DELETE') handleDeleteMdbItem($authUser, $databaseId, $columnId, 'columns');
    respond(405, ['error' => 'Method not allowed']);
}
if (is_string($path) && preg_match('#^/databases/([1-9][0-9]*)/columns/([1-9][0-9]*)/width$#D', $path, $match)) {
    $databaseId = filter_var($match[1], FILTER_VALIDATE_INT);
    $columnId = filter_var($match[2], FILTER_VALIDATE_INT);
    if ($databaseId === false || $columnId === false) respond(404, ['error' => 'Not found']);
    if ($method === 'PATCH') handleResizeMdbColumn($authUser, $databaseId, $columnId);
    respond(405, ['error' => 'Method not allowed']);
}
if (is_string($path) && preg_match('#^/databases/([1-9][0-9]*)/rows/([1-9][0-9]*)$#D', $path, $match)) {
    $databaseId = filter_var($match[1], FILTER_VALIDATE_INT);
    $rowId = filter_var($match[2], FILTER_VALIDATE_INT);
    if ($databaseId === false || $rowId === false) respond(404, ['error' => 'Not found']);
    if ($method === 'DELETE') handleDeleteMdbItem($authUser, $databaseId, $rowId, 'rows');
    respond(405, ['error' => 'Method not allowed']);
}
if (is_string($path) && preg_match('#^/databases/([1-9][0-9]*)/rows/([1-9][0-9]*)/usage$#D', $path, $match)) {
    $databaseId = filter_var($match[1], FILTER_VALIDATE_INT);
    $rowId = filter_var($match[2], FILTER_VALIDATE_INT);
    if ($databaseId === false || $rowId === false) respond(404, ['error' => 'Not found']);
    if ($method === 'GET') handleGetMdbRowUsage($authUser, $databaseId, $rowId);
    respond(405, ['error' => 'Method not allowed']);
}
if (is_string($path) && preg_match('#^/databases/([1-9][0-9]*)/rows/([1-9][0-9]*)/cells/([1-9][0-9]*)$#D', $path, $match)) {
    $ids = array_map(static fn (string $value): int|false => filter_var($value, FILTER_VALIDATE_INT),
        array_slice($match, 1));
    if (in_array(false, $ids, true)) respond(404, ['error' => 'Not found']);
    if ($method === 'PUT') handleSaveMdbCell($authUser, $ids[0], $ids[1], $ids[2]);
    respond(405, ['error' => 'Method not allowed']);
}
respond(404, ['error' => 'Not found']);
