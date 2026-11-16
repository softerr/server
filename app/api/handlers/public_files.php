<?php
declare(strict_types=1);

const PUBLIC_FILE_MAX_BYTES = 25165824;
const PUBLIC_FILE_USER_MAX_BYTES = 1073741824;
const PUBLIC_FILE_USER_MAX_COUNT = 1000;

function publicFileName(string $name): string
{
    if ($name === '' || strlen($name) > 255 || trim($name) === ''
        || $name === '.' || $name === '..' || preg_match('//u', $name) !== 1
        || preg_match('~[\x00-\x1f\x7f/\\\\]~u', $name) === 1) {
        respond(400, ['error' => 'Invalid filename']);
    }
    return $name;
}

function publicFileResponse(array $row): array
{
    $name = $row['original_name'];
    return ['id' => (int) $row['id'], 'name' => $name,
        'size_bytes' => (int) $row['size_bytes'], 'mime_type' => $row['mime_type'],
        'created' => $row['created'],
        'url' => '/files/' . trim($row['public_id']) . '/' . rawurlencode($name)];
}

function publicFileOwner(): int
{
    $user = currentSessionUser();
    // Public links belong to the signed-in human account. API tokens are not
    // granted permission to publish content on their creator's behalf.
    if (isset($user['api_token_id'])) respond(403, ['error' => 'Browser session required']);
    return (int) $user['id'];
}

function handleListPublicFiles(): never
{
    $ownerId = publicFileOwner();
    $db = connectMediaDb();
    $result = @pg_query_params($db,
        'SELECT id, public_id, original_name, mime_type, size_bytes, created
         FROM public.public_file WHERE owner_auth_user_id = $1 ORDER BY id DESC', [$ownerId]);
    if ($result === false) respond(500, ['error' => 'Could not list files']);
    $files = [];
    $bytes = 0;
    while (($row = pg_fetch_assoc($result)) !== false) {
        $files[] = publicFileResponse($row);
        $bytes += (int) $row['size_bytes'];
    }
    respond(200, ['files' => $files, 'usage' => ['count' => count($files), 'bytes' => $bytes],
        'limits' => ['count' => PUBLIC_FILE_USER_MAX_COUNT,
            'bytes' => PUBLIC_FILE_USER_MAX_BYTES, 'per_file_bytes' => PUBLIC_FILE_MAX_BYTES]]);
}

function handleUploadPublicFile(): never
{
    $ownerId = publicFileOwner();
    $header = $_SERVER['HTTP_X_FILE_NAME'] ?? null;
    if (!is_string($header) || $header === '') respond(400, ['error' => 'X-File-Name is required']);
    $name = publicFileName(rawurldecode($header));
    $bytes = file_get_contents('php://input', false, null, 0, PUBLIC_FILE_MAX_BYTES + 1);
    if ($bytes === false || $bytes === '' || strlen($bytes) > PUBLIC_FILE_MAX_BYTES) {
        respond(413, ['error' => 'File must be between 1 byte and 24 MiB']);
    }
    $size = strlen($bytes);
    $hash = hash('sha256', $bytes);
    $detected = (new finfo(FILEINFO_MIME_TYPE))->buffer($bytes);
    $mime = is_string($detected) && strlen($detected) <= 128 ? $detected : 'application/octet-stream';
    $db = connectMediaDb();
    if (@pg_query($db, 'BEGIN') === false
        || @pg_query_params($db, 'SELECT pg_advisory_xact_lock($1)', [$ownerId]) === false) {
        respond(500, ['error' => 'Could not save file']);
    }
    $usage = @pg_query_params($db,
        'SELECT COUNT(*) AS count, COALESCE(SUM(size_bytes), 0) AS bytes
         FROM public.public_file WHERE owner_auth_user_id = $1', [$ownerId]);
    if ($usage === false || ($totals = pg_fetch_assoc($usage)) === false) {
        respond(500, ['error' => 'Could not check file usage']);
    }
    if ((int) $totals['count'] >= PUBLIC_FILE_USER_MAX_COUNT
        || (int) $totals['bytes'] + $size > PUBLIC_FILE_USER_MAX_BYTES) {
        respond(413, ['error' => 'Public file storage limit reached']);
    }
    try {
        mediaStorageWrite('files', $hash, $bytes);
    } catch (RuntimeException $error) {
        error_log($error->getMessage());
        respond(500, ['error' => 'Could not save file']);
    }
    $saved = @pg_query_params($db,
        'INSERT INTO public.public_file
            (owner_auth_user_id, public_id, original_name, mime_type, size_bytes, sha256)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, public_id, original_name, mime_type, size_bytes, created',
        [$ownerId, bin2hex(random_bytes(16)), $name, $mime, $size, $hash]);
    if ($saved === false || ($row = pg_fetch_assoc($saved)) === false
        || @pg_query($db, 'COMMIT') === false) respond(500, ['error' => 'Could not save file']);
    respond(201, publicFileResponse($row));
}

function handleDeletePublicFile(int $fileId): never
{
    $ownerId = publicFileOwner();
    $result = @pg_query_params(connectMediaDb(),
        'DELETE FROM public.public_file WHERE id = $1 AND owner_auth_user_id = $2 RETURNING id',
        [$fileId, $ownerId]);
    if ($result === false) respond(500, ['error' => 'Could not delete file']);
    if (pg_num_rows($result) === 0) respond(404, ['error' => 'File not found']);
    respond(200, ['deleted' => true]);
}

function handleGetPublicFile(string $path, bool $head): never
{
    if (preg_match('#^/files/([a-f0-9]{32})/([^/]+)$#D', $path, $match) !== 1) {
        respond(404, ['error' => 'File not found']);
    }
    $name = rawurldecode($match[2]);
    $result = @pg_query_params(connectMediaDb(),
        'SELECT original_name, mime_type, size_bytes, sha256
         FROM public.public_file WHERE public_id = $1', [$match[1]]);
    if ($result === false) respond(500, ['error' => 'Could not load file']);
    $row = pg_fetch_assoc($result);
    if ($row === false || $name !== $row['original_name']) respond(404, ['error' => 'File not found']);
    $filePath = mediaStoragePath('files', $row['sha256']);
    if (!is_file($filePath) || filesize($filePath) !== (int) $row['size_bytes']) {
        respond(500, ['error' => 'Stored file is unavailable']);
    }
    $stream = $head ? null : @fopen($filePath, 'rb');
    if (!$head && $stream === false) respond(500, ['error' => 'Could not read file']);
    $safeInline = in_array($row['mime_type'], ['image/png', 'image/jpeg', 'image/webp', 'image/gif'], true);
    header('Content-Type: ' . ($safeInline ? $row['mime_type'] : 'application/octet-stream'));
    header('Content-Length: ' . $row['size_bytes']);
    header('Content-Disposition: ' . ($safeInline ? 'inline' : 'attachment')
        . "; filename*=UTF-8''" . rawurlencode($row['original_name']));
    header('X-Content-Type-Options: nosniff');
    header('Content-Security-Policy: sandbox');
    header('Cache-Control: no-store');
    if (!$head) {
        fpassthru($stream);
        fclose($stream);
    }
    exit;
}
