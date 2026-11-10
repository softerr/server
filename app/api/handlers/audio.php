<?php
declare(strict_types=1);

const MEDIA_AUDIO_MAX_BYTES = 25165824;
const MEDIA_AUDIO_USER_MAX_BYTES = 6442450944;

function mediaAudioType(string $name, string $bytes): ?string
{
    $extension = strtolower(pathinfo($name, PATHINFO_EXTENSION));
    if ($extension === 'mp3' && (str_starts_with($bytes, 'ID3')
        || (strlen($bytes) > 1 && ord($bytes[0]) === 0xff && (ord($bytes[1]) & 0xe0) === 0xe0))) return 'audio/mpeg';
    if ($extension === 'ogg' && str_starts_with($bytes, 'OggS')) return 'audio/ogg';
    if ($extension === 'wav' && str_starts_with($bytes, 'RIFF') && substr($bytes, 8, 4) === 'WAVE') return 'audio/wav';
    if ($extension === 'flac' && str_starts_with($bytes, 'fLaC')) return 'audio/flac';
    if ($extension === 'm4a' && substr($bytes, 4, 4) === 'ftyp') return 'audio/mp4';
    return null;
}

function mediaAudioName(string $name): string
{
    if ($name === '' || strlen($name) > 255 || trim($name) === ''
        || preg_match('//u', $name) !== 1 || preg_match('~[\x00-\x1f\x7f/\\\\]~u', $name)) {
        respond(400, ['error' => 'Invalid audio filename']);
    }
    return $name;
}

function mediaAudioUsage($db, int $ownerId): int
{
    $result = @pg_query_params($db,
        'SELECT COALESCE(SUM(size_bytes), 0) FROM public.audio_file WHERE owner_auth_user_id = $1',
        [$ownerId]);
    if ($result === false) respond(500, ['error' => 'Could not check audio usage']);
    return (int) pg_fetch_result($result, 0, 0);
}

function saveMediaAudioFile($db, int $ownerId, string $name, string $mime, string $bytes, string $sha256): array
{
    if (@pg_query($db, 'BEGIN') === false
        || @pg_query_params($db, 'SELECT pg_advisory_xact_lock($1)', [$ownerId]) === false) {
        respond(500, ['error' => 'Could not save audio file']);
    }
    $existing = @pg_query_params($db,
        'SELECT id, original_name, mime_type, size_bytes, sha256, created
         FROM public.audio_file WHERE owner_auth_user_id = $1 AND sha256 = $2', [$ownerId, $sha256]);
    if ($existing === false) respond(500, ['error' => 'Could not check audio file']);
    $row = pg_fetch_assoc($existing);
    if ($row !== false) {
        if (@pg_query($db, 'COMMIT') === false) respond(500, ['error' => 'Could not save audio file']);
        return $row;
    }
    if (mediaAudioUsage($db, $ownerId) + strlen($bytes) > MEDIA_AUDIO_USER_MAX_BYTES) {
        respond(413, ['error' => 'Your audio files are limited to 6 GiB']);
    }
    $saved = @pg_query_params($db,
        'INSERT INTO public.audio_file (owner_auth_user_id, original_name, mime_type, size_bytes, sha256, content)
         VALUES ($1, $2, $3, $4, $5, decode($6, \'base64\'))
         RETURNING id, original_name, mime_type, size_bytes, sha256, created',
        [$ownerId, $name, $mime, strlen($bytes), $sha256, base64_encode($bytes)]);
    if ($saved === false || ($row = pg_fetch_assoc($saved)) === false
        || @pg_query($db, 'COMMIT') === false) respond(500, ['error' => 'Could not save audio file']);
    return $row;
}

function publicMediaAudio(array $row): array
{
    return ['id' => (int) $row['id'], 'name' => $row['original_name'],
        'mime_type' => $row['mime_type'], 'size_bytes' => (int) $row['size_bytes'],
        'sha256' => trim($row['sha256']), 'created' => $row['created']];
}

function handleListMediaAudio(): never
{
    $user = appAccessUser(currentSessionUser(), 'musico', false);
    $ownerAudioIds = musicoOwnerAudioIds($user);
    $allOwner = tokenOwnerAccess($user, 'musico') !== null;
    $db = connectMediaDb();
    $result = @pg_query_params($db,
        'SELECT id, original_name, mime_type, size_bytes, sha256, created
         FROM public.audio_file WHERE owner_auth_user_id = $1
            OR (owner_auth_user_id = $2 AND ($4::boolean OR id = ANY($3::bigint[])))
         ORDER BY lower(original_name), id',
        [$user['service_account_id'] ?? $user['id'], $user['service_owner_id'] ?? null,
         '{' . implode(',', $ownerAudioIds) . '}', $allOwner ? 't' : 'f']);
    if ($result === false) respond(500, ['error' => 'Could not load audio files']);
    $items = [];
    while (($row = pg_fetch_assoc($result)) !== false) $items[] = publicMediaAudio($row);
    $musico = connectMusicoDb();
    $used = @pg_query_params($musico,
        'SELECT t.media_audio_id, t.id FROM public.track t
         JOIN public."user" u ON u.id = t.user_id
         WHERE u.auth_user_id = $1 OR (u.auth_user_id = $2
            AND ($5::boolean OR (t.media_audio_id = ANY($3::bigint[])
              AND EXISTS (SELECT 1 FROM public.playlist_track pt
                WHERE pt.track_id = t.id AND pt.playlist_id = ANY($4::bigint[])))))',
        [$user['service_account_id'] ?? $user['id'], $user['service_owner_id'] ?? null,
         '{' . implode(',', $ownerAudioIds) . '}',
         '{' . implode(',', tokenOwnerResourceIds($user, 'musico')) . '}', $allOwner ? 't' : 'f']);
    if ($used === false) respond(500, ['error' => 'Could not check audio use']);
    $songIds = [];
    while (($song = pg_fetch_assoc($used)) !== false) {
        $songIds[(int) $song['media_audio_id']][] = (int) $song['id'];
    }
    foreach ($items as &$item) $item['musico_song_ids'] = $songIds[$item['id']] ?? [];
    unset($item);
    respond(200, ['audio' => $items,
        'usage' => ['count' => count($items), 'bytes' => mediaAudioUsage($db, (int) $user['id'])],
        'limits' => ['bytes' => MEDIA_AUDIO_USER_MAX_BYTES, 'per_file_bytes' => MEDIA_AUDIO_MAX_BYTES]]);
}

function handleUploadMediaAudio(): never
{
    $user = appAccessUser(currentSessionUser(), 'musico', true);
    $nameHeader = $_SERVER['HTTP_X_AUDIO_NAME'] ?? null;
    $name = is_string($nameHeader) ? mediaAudioName(rawurldecode($nameHeader)) : '';
    if ($name === '') respond(400, ['error' => 'Audio filename is required']);
    $bytes = file_get_contents('php://input', false, null, 0, MEDIA_AUDIO_MAX_BYTES + 1);
    if ($bytes === false || $bytes === '' || strlen($bytes) > MEDIA_AUDIO_MAX_BYTES) {
        respond(413, ['error' => 'Audio file must be at most 24 MiB']);
    }
    $mime = mediaAudioType($name, $bytes);
    if ($mime === null) respond(400, ['error' => 'Choose an MP3, Ogg, WAV, FLAC, or M4A audio file']);
    $row = saveMediaAudioFile(connectMediaDb(), (int) $user['id'], $name, $mime, $bytes, hash('sha256', $bytes));
    respond(201, publicMediaAudio($row));
}

function streamMediaAudio($db, int $audioId, int $ownerId): never
{
    $result = @pg_query_params($db,
        'SELECT mime_type, size_bytes FROM public.audio_file WHERE id = $1 AND owner_auth_user_id = $2',
        [$audioId, $ownerId]);
    if ($result === false) respond(500, ['error' => 'Could not load audio file']);
    $file = pg_fetch_assoc($result);
    if ($file === false) respond(404, ['error' => 'Audio file not found']);
    $size = (int) $file['size_bytes'];
    $start = 0;
    $end = $size - 1;
    if (isset($_SERVER['HTTP_RANGE'])) {
        $range = (string) $_SERVER['HTTP_RANGE'];
        if (preg_match('/^bytes=(\d*)-(\d*)$/D', $range, $match) !== 1 || ($match[1] === '' && $match[2] === '')) {
            header("Content-Range: bytes */{$size}");
            respond(416, ['error' => 'Invalid audio range']);
        }
        if ($match[1] === '') {
            $length = min((int) $match[2], $size);
            $start = $size - $length;
        } else {
            $start = (int) $match[1];
            if ($match[2] !== '') $end = min((int) $match[2], $end);
        }
        if ($start > $end || $start >= $size) {
            header("Content-Range: bytes */{$size}");
            respond(416, ['error' => 'Invalid audio range']);
        }
        http_response_code(206);
        header("Content-Range: bytes {$start}-{$end}/{$size}");
    }
    $length = $end - $start + 1;
    $data = @pg_query_params($db,
        'SELECT encode(substring(content FROM $2 FOR $3), \'base64\')
         FROM public.audio_file WHERE id = $1 AND owner_auth_user_id = $4',
        [$audioId, $start + 1, $length, $ownerId]);
    if ($data === false || ($encoded = pg_fetch_result($data, 0, 0)) === false
        || ($bytes = base64_decode($encoded, true)) === false) respond(500, ['error' => 'Could not stream audio file']);
    header('Content-Type: ' . $file['mime_type']);
    header('Content-Length: ' . strlen($bytes));
    header('Accept-Ranges: bytes');
    header('Cache-Control: private, no-store');
    header('X-Content-Type-Options: nosniff');
    echo $bytes;
    exit;
}

function handleGetMediaAudio(int $id): never
{
    $user = musicoAudioAccessUser(currentSessionUser(), $id, false);
    streamMediaAudio(connectMediaDb(), $id, (int) $user['id']);
}

function handleDeleteMediaAudio(int $id): never
{
    $user = musicoAudioAccessUser(currentSessionUser(), $id, true);
    // The same per-account lock serializes deletion with Musico track creation.
    $musico = connectMusicoDb();
    if (@pg_query($musico, 'BEGIN') === false
        || @pg_query_params($musico, 'SELECT pg_advisory_xact_lock($1)', [$user['id']]) === false) {
        respond(500, ['error' => 'Could not check audio references']);
    }
    $references = @pg_query_params($musico,
        'SELECT 1 FROM public.track t JOIN public."user" u ON u.id = t.user_id
         WHERE t.media_audio_id = $1 AND u.auth_user_id = $2 LIMIT 1', [$id, $user['id']]);
    if ($references === false) respond(500, ['error' => 'Could not check audio references']);
    if (pg_num_rows($references) !== 0) respond(409, ['error' => 'Audio file is used by a song']);
    $db = connectMediaDb();
    $deleted = @pg_query_params($db,
        'DELETE FROM public.audio_file WHERE id = $1 AND owner_auth_user_id = $2 RETURNING id', [$id, $user['id']]);
    if ($deleted === false) respond(500, ['error' => 'Could not delete audio file']);
    if (pg_num_rows($deleted) === 0) respond(404, ['error' => 'Audio file not found']);
    if (@pg_query($musico, 'COMMIT') === false) respond(500, ['error' => 'Could not delete audio file']);
    http_response_code(204);
    exit;
}
