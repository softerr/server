<?php
declare(strict_types=1);

header('Content-Type: application/json');

require_once __DIR__ . '/lib/http.php';
require_once __DIR__ . '/lib/url.php';
require_once __DIR__ . '/lib/session.php';
require_once __DIR__ . '/handlers/audio.php';
require_once __DIR__ . '/apps/musico/handlers.php';

$path = apiRequestPath('/api/musico');
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$authUser = appAccessUser(currentSessionUser(), 'musico', $method !== 'GET');

if ($path === '/me') {
    if ($method === 'PUT') handleMusicoMe($authUser);
    respond(405, ['error' => 'Method not allowed']);
}
if ($path === '/changes') {
    if ($method === 'GET') handleMusicoChanges($authUser);
    respond(405, ['error' => 'Method not allowed']);
}
if ($path === '/tracks') {
    if ($method === 'GET') handleListMusicoTracks($authUser);
    if ($method === 'POST') handleUploadMusicoTrack($authUser);
    respond(405, ['error' => 'Method not allowed']);
}
if ($path === '/tracks/order') {
    if ($method === 'PUT') handleSaveMusicoTrackOrder($authUser);
    respond(405, ['error' => 'Method not allowed']);
}
if ($path === '/tracks/from-media') {
    if ($method === 'POST') handleCreateMusicoTrackFromMedia($authUser);
    respond(405, ['error' => 'Method not allowed']);
}
if (is_string($path) && preg_match('#^/tracks/([1-9][0-9]*)/file$#D', $path, $match)) {
    $id = filter_var($match[1], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    if ($id === false) respond(404, ['error' => 'Not found']);
    if ($method === 'GET') handleStreamMusicoTrack($authUser, $id);
    respond(405, ['error' => 'Method not allowed']);
}
if (is_string($path) && preg_match('#^/tracks/([1-9][0-9]*)/analysis$#D', $path, $match)) {
    $id = filter_var($match[1], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    if ($id === false) respond(404, ['error' => 'Not found']);
    if ($method === 'PUT') handleSaveMusicoTrackAnalysis($authUser, $id);
    respond(405, ['error' => 'Method not allowed']);
}
if (is_string($path) && preg_match('#^/tracks/([1-9][0-9]*)$#D', $path, $match)) {
    $id = filter_var($match[1], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    if ($id === false) respond(404, ['error' => 'Not found']);
    if ($method === 'GET') handleGetMusicoTrack($authUser, $id);
    if ($method === 'DELETE') handleDeleteMusicoTrack($authUser, $id);
    if ($method === 'PATCH') handleUpdateMusicoTrack($authUser, $id);
    respond(405, ['error' => 'Method not allowed']);
}
if (is_string($path) && preg_match('#^/tracks/([1-9][0-9]*)/listen$#D', $path, $match)) {
    $id = filter_var($match[1], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    if ($id === false) respond(404, ['error' => 'Not found']);
    if ($method === 'POST') handleRecordMusicoListen($authUser, $id);
    respond(405, ['error' => 'Method not allowed']);
}
if (is_string($path) && preg_match('#^/tracks/([1-9][0-9]*)/restore-stats$#D', $path, $match)) {
    $id = filter_var($match[1], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    if ($id === false) respond(404, ['error' => 'Not found']);
    if ($method === 'POST') handleRestoreMusicoTrackStats($authUser, $id);
    respond(405, ['error' => 'Method not allowed']);
}
if ($path === '/playlists') {
    if ($method === 'GET') handleListMusicoPlaylists($authUser);
    if ($method === 'POST') handleCreateMusicoPlaylist($authUser);
    respond(405, ['error' => 'Method not allowed']);
}
if (is_string($path) && preg_match('#^/playlists/([1-9][0-9]*)/tracks/([1-9][0-9]*)$#D', $path, $match)) {
    $playlistId = filter_var($match[1], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    $trackId = filter_var($match[2], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    if ($playlistId === false || $trackId === false) respond(404, ['error' => 'Not found']);
    if ($method === 'DELETE') handleRemoveMusicoPlaylistTrack($authUser, $playlistId, $trackId);
    respond(405, ['error' => 'Method not allowed']);
}
if (is_string($path) && preg_match('#^/playlists/([1-9][0-9]*)/tracks$#D', $path, $match)) {
    $id = filter_var($match[1], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    if ($id === false) respond(404, ['error' => 'Not found']);
    if ($method === 'POST') handleAddMusicoPlaylistTrack($authUser, $id);
    if ($method === 'PUT') handleReplaceMusicoPlaylistTracks($authUser, $id);
    respond(405, ['error' => 'Method not allowed']);
}
if (is_string($path) && preg_match('#^/playlists/([1-9][0-9]*)$#D', $path, $match)) {
    $id = filter_var($match[1], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    if ($id === false) respond(404, ['error' => 'Not found']);
    if ($method === 'GET') handleGetMusicoPlaylist($authUser, $id);
    if ($method === 'PATCH') handleRenameMusicoPlaylist($authUser, $id);
    if ($method === 'DELETE') handleDeleteMusicoPlaylist($authUser, $id);
    respond(405, ['error' => 'Method not allowed']);
}
respond(404, ['error' => 'Not found']);
