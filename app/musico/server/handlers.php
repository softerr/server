<?php
declare(strict_types=1);

require_once __DIR__ . '/artwork_names.php';

const MUSICO_TRACK_MAX_BYTES = MEDIA_AUDIO_MAX_BYTES;
const MUSICO_USER_MAX_BYTES = MEDIA_AUDIO_USER_MAX_BYTES;
const MUSICO_ANALYSIS_COLUMNS = ['duration_ms', 'bit_rate', 'sample_rate_hz', 'bit_depth',
    'channels', 'codec', 'estimated_bpm', 'estimated_key', 'peak_db', 'average_db',
    'dynamic_range_db', 'analysis_saved_at'];

function musicoAnalysisProjection(string $alias = ''): string
{
    $prefix = $alias === '' ? '' : $alias . '.';
    return implode(', ', array_map(static fn (string $column): string => $prefix . $column,
        MUSICO_ANALYSIS_COLUMNS));
}

function publicMusicoAnalysis(array $row): ?array
{
    if ($row['analysis_saved_at'] === null) return null;
    $integers = ['duration_ms', 'bit_rate', 'sample_rate_hz', 'bit_depth', 'channels', 'estimated_bpm'];
    $decimals = ['peak_db', 'average_db', 'dynamic_range_db'];
    $analysis = [];
    foreach (MUSICO_ANALYSIS_COLUMNS as $column) {
        if ($column === 'analysis_saved_at') continue;
        $value = $row[$column];
        $analysis[$column] = $value === null ? null
            : (in_array($column, $integers, true) ? (int) $value
                : (in_array($column, $decimals, true) ? (float) $value : $value));
    }
    return $analysis;
}

function musicoText(mixed $value, int $maxBytes, string $label): string
{
    if (!is_string($value) || strlen($value) > $maxBytes || preg_match('//u', $value) !== 1
        || preg_match('/[\x00-\x1f\x7f]/u', $value)) {
        respond(400, ['error' => "Invalid {$label}"]);
    }
    $text = trim($value);
    if ($text === '' || strlen($text) > $maxBytes) respond(400, ['error' => "Invalid {$label}"]);
    return $text;
}

function musicoCurrentId($db, array $authUser): ?int
{
    $result = @pg_query_params($db, 'SELECT id FROM public."user" WHERE auth_user_id = $1', [$authUser['id']]);
    if ($result === false) respond(500, ['error' => 'Failed to load Musico account']);
    if (pg_num_rows($result) === 0) return null;
    $id = pg_fetch_result($result, 0, 0);
    return $id === false ? null : (int) $id;
}

function beginMusicoMutation($db, array $authUser): void
{
    if (@pg_query($db, 'BEGIN') === false
        || @pg_query_params($db, 'SELECT pg_advisory_xact_lock($1)', [$authUser['id']]) === false) {
        respond(500, ['error' => 'Failed to update Musico']);
    }
    $active = @pg_query_params(connectDb(),
        'SELECT 1 FROM public."user" WHERE id = $1 AND verified = TRUE
         AND approved_at IS NOT NULL AND deleting = FALSE', [$authUser['id']]);
    if ($active === false) respond(500, ['error' => 'Failed to authorize Musico account']);
    if (pg_num_rows($active) === 0) respond(401, ['error' => 'Not authenticated']);
}

function ensureMusicoUserId($db, array $authUser): int
{
    $created = @pg_query_params($db,
        'INSERT INTO public."user" (auth_user_id) VALUES ($1) ON CONFLICT (auth_user_id) DO NOTHING',
        [$authUser['id']]);
    if ($created === false) respond(500, ['error' => 'Failed to initialize Musico account']);
    $id = musicoCurrentId($db, $authUser);
    if ($id === null) respond(500, ['error' => 'Failed to initialize Musico account']);
    return $id;
}

function finishMusicoMutation($db): void
{
    if (@pg_query($db, 'COMMIT') === false) respond(500, ['error' => 'Failed to update Musico']);
}

function requiredMusicoVersion(string $kind = 'v'): int
{
    $header = $_SERVER['HTTP_IF_MATCH'] ?? null;
    if ($header === null) respond(428, ['error' => 'If-Match is required']);
    if (!is_string($header) || preg_match('/^"' . $kind . '([1-9][0-9]*)"$/D', $header, $match) !== 1) {
        respond(400, ['error' => 'Invalid If-Match']);
    }
    $version = filter_var($match[1], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    if ($version === false) respond(400, ['error' => 'Invalid If-Match']);
    return $version;
}

function assertMusicoVersion($db, array $authUser, string $resource, int $id,
    int $expected, bool $stats = false): void
{
    if ($resource !== 'track' && $resource !== 'playlist') {
        throw new LogicException('Invalid Musico resource');
    }
    $column = $stats ? 'stats_version' : 'version';
    $result = @pg_query_params($db,
        'SELECT item.' . $column . ' FROM public.' . $resource . ' item
         JOIN public."user" u ON u.id = item.user_id
         WHERE item.id = $1 AND u.auth_user_id = $2', [$id, $authUser['id']]);
    if ($result === false) respond(500, ['error' => 'Could not check Musico version']);
    $row = pg_fetch_assoc($result);
    if ($row === false) respond(404, ['error' => ucfirst($resource) . ' not found']);
    $current = (int) $row[$column];
    if ($current !== $expected) {
        header('ETag: "' . ($stats ? 's' : 'v') . $current . '"');
        respond(412, ['error' => 'This item changed. Reload the page before retrying.',
            'current_version' => $current]);
    }
}

function recordMusicoChange($db, array $authUser, string $resource, int $resourceId,
    string $action = 'upsert'): void
{
    $saved = @pg_query_params($db,
        'INSERT INTO public.change_log (user_id, resource, resource_id, action)
         SELECT id, $2, $3, $4 FROM public."user" WHERE auth_user_id = $1',
        [$authUser['id'], $resource, $resourceId, $action]);
    if ($saved === false || pg_affected_rows($saved) !== 1) {
        respond(500, ['error' => 'Could not record Musico change']);
    }
}

function musicoChangeCursor(array $row): string
{
    return $row['id'] . '.' . $row['cursor_token'];
}

function handleMusicoChanges(array $authUser): never
{
    header('Cache-Control: private, no-store');
    $after = $_GET['after'] ?? null;
    if ($after === null) {
        if (isset($_GET['limit'])) respond(400, ['error' => 'limit requires an after cursor']);
        $db = connectMusicoDb();
        if (@pg_query($db, 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY') === false) {
            respond(500, ['error' => 'Could not load Musico snapshot']);
        }
        $userId = musicoCurrentId($db, $authUser);
        if ($userId === null) {
            if (@pg_query($db, 'COMMIT') === false) respond(500, ['error' => 'Could not load Musico snapshot']);
            respond(200, ['cursor' => '0', 'tracks' => [], 'playlists' => []]);
        }
        $latest = @pg_query_params($db,
            'SELECT id, cursor_token FROM public.change_log
             WHERE user_id = $1 ORDER BY id DESC LIMIT 1', [$userId]);
        $tracks = @pg_query_params($db,
            'SELECT t.id, t.title, t.artist, t.media_audio_id,
                    t.version, t.stats_version,
                    t.album, t.genre, t.release_year, t.track_number, t.rating, t.play_count, t.listen_ms,
                    t.art_image_id, ' . musicoAnalysisProjection('t') . ', t.created
             FROM public.track t WHERE t.user_id = $1 ORDER BY t.id', [$userId]);
        $playlists = @pg_query_params($db,
            'SELECT p.id, p.name, p.created, p.version,
                    (SELECT COUNT(*) FROM public.playlist_track pt WHERE pt.playlist_id = p.id) AS track_count,
                    COALESCE((SELECT json_agg(pt.track_id ORDER BY pt.position, pt.track_id)
                              FROM public.playlist_track pt WHERE pt.playlist_id = p.id), \'[]\') AS track_ids
             FROM public.playlist p WHERE p.user_id = $1 ORDER BY p.id', [$userId]);
        if ($latest === false || $tracks === false || $playlists === false) {
            respond(500, ['error' => 'Could not load Musico snapshot']);
        }
        $trackRows = publicMusicoTracks($tracks, (int) $authUser['id']);
        $playlistRows = [];
        while (($row = pg_fetch_assoc($playlists)) !== false) {
            $playlistRows[] = publicMusicoPlaylist($row) + ['track_ids' => json_decode($row['track_ids'], true)];
        }
        $latestRow = pg_fetch_assoc($latest);
        $cursor = $latestRow === false ? '0' : musicoChangeCursor($latestRow);
        if (@pg_query($db, 'COMMIT') === false) respond(500, ['error' => 'Could not load Musico snapshot']);
        respond(200, ['cursor' => $cursor, 'tracks' => $trackRows, 'playlists' => $playlistRows]);
    }

    $cursorId = null;
    $cursorToken = null;
    if ($after === '0') {
        $cursorId = 0;
    } elseif (is_string($after) && preg_match(
        '/^([1-9][0-9]*)\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/D',
        $after, $match) === 1) {
        $cursorId = filter_var($match[1], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
        $cursorToken = $match[2];
    }
    $limitInput = $_GET['limit'] ?? '100';
    $limit = filter_var($limitInput, FILTER_VALIDATE_INT,
        ['options' => ['min_range' => 1, 'max_range' => 200]]);
    if ($cursorId === null || $cursorId === false || $limit === false) {
        respond(400, ['error' => 'Invalid change cursor or limit']);
    }
    $db = connectMusicoDb();
    $userId = musicoCurrentId($db, $authUser);
    if ($userId === null && $cursorId !== 0) {
        respond(409, ['error' => 'Change cursor is no longer valid', 'reset_required' => true]);
    }
    if ($userId === null) respond(200, ['changes' => [], 'next_cursor' => '0', 'has_more' => false]);
    if ($cursorId !== 0) {
        $checkpoint = @pg_query_params($db,
            'SELECT cursor_token FROM public.change_log WHERE user_id = $1 AND id = $2',
            [$userId, $cursorId]);
        if ($checkpoint === false) respond(500, ['error' => 'Could not check Musico cursor']);
        $row = pg_fetch_assoc($checkpoint);
        if ($row === false || !hash_equals($row['cursor_token'], $cursorToken)) {
            respond(409, ['error' => 'Change cursor is no longer valid', 'reset_required' => true]);
        }
    }
    $result = @pg_query_params($db,
        'SELECT id, cursor_token, resource, resource_id, action, created FROM public.change_log
         WHERE user_id = $1 AND id > $2 ORDER BY id LIMIT $3',
        [$userId, $cursorId, $limit + 1]);
    if ($result === false) respond(500, ['error' => 'Could not load Musico changes']);
    $changes = [];
    while (($row = pg_fetch_assoc($result)) !== false) {
        $changes[] = ['cursor' => musicoChangeCursor($row), 'resource' => $row['resource'],
            'id' => (int) $row['resource_id'], 'action' => $row['action'], 'created' => $row['created']];
    }
    $hasMore = count($changes) > $limit;
    if ($hasMore) array_pop($changes);
    $nextCursor = $changes === [] ? $after : $changes[count($changes) - 1]['cursor'];
    respond(200, ['changes' => $changes, 'next_cursor' => $nextCursor, 'has_more' => $hasMore]);
}

function handleMusicoMe(array $authUser): never
{
    $db = connectMusicoDb();
    beginMusicoMutation($db, $authUser);
    $id = ensureMusicoUserId($db, $authUser);
    finishMusicoMutation($db);
    header('Cache-Control: private, no-store');
    respond(200, ['id' => $id, 'auth_user_id' => (int) $authUser['id']]);
}

function musicoAudioFiles(array $rows, int $authUserId): array
{
    $ids = array_values(array_unique(array_map(static fn (array $row): int =>
        (int) $row['media_audio_id'], $rows)));
    if ($ids === []) return [];
    $result = @pg_query_params(connectMediaDb(),
        'SELECT id, original_name, mime_type, size_bytes, sha256
         FROM public.audio_file WHERE owner_auth_user_id = $1 AND id = ANY($2::bigint[])',
        [$authUserId, '{' . implode(',', $ids) . '}']);
    if ($result === false) respond(500, ['error' => 'Could not load song audio']);
    $files = [];
    while (($file = pg_fetch_assoc($result)) !== false) $files[(int) $file['id']] = $file;
    if (count($files) !== count($ids)) respond(503, ['error' => 'Song audio is unavailable']);
    return $files;
}

function publicMusicoTrack(array $row, int $authUserId, ?array $file = null): array
{
    $file ??= musicoAudioFiles([$row], $authUserId)[(int) $row['media_audio_id']];
    return [
        'id' => (int) $row['id'],
        'title' => $row['title'],
        'artist' => $row['artist'],
        'original_name' => $file['original_name'],
        'mime_type' => $file['mime_type'],
        'size_bytes' => (int) $file['size_bytes'],
        'content_sha256' => trim($file['sha256']),
        'media_audio_id' => (int) $row['media_audio_id'],
        'version' => (int) $row['version'],
        'stats_version' => (int) $row['stats_version'],
        'album' => $row['album'],
        'genre' => $row['genre'],
        'year' => $row['release_year'] === null ? null : (int) $row['release_year'],
        'track_number' => $row['track_number'] === null ? null : (int) $row['track_number'],
        'rating' => $row['rating'] === null ? null : (int) $row['rating'],
        'play_count' => (int) $row['play_count'],
        'listen_ms' => (int) $row['listen_ms'],
        'art_image_id' => $row['art_image_id'] === null ? null : (int) $row['art_image_id'],
        'analysis' => publicMusicoAnalysis($row),
        'created' => $row['created'],
    ];
}

function publicMusicoTracks($result, int $authUserId): array
{
    $rows = [];
    while (($row = pg_fetch_assoc($result)) !== false) $rows[] = $row;
    $files = musicoAudioFiles($rows, $authUserId);
    return array_map(static fn (array $row): array => publicMusicoTrack(
        $row, $authUserId, $files[(int) $row['media_audio_id']]), $rows);
}

function handleListMusicoTracks(array $authUser): never
{
    $db = connectMusicoDb();
    $result = @pg_query_params($db,
        'SELECT t.id, t.title, t.artist, t.media_audio_id,
                t.version, t.stats_version,
                t.album, t.genre, t.release_year, t.track_number, t.rating, t.play_count, t.listen_ms, t.art_image_id, '
                . musicoAnalysisProjection('t') . ', t.created
         FROM public.track t JOIN public."user" u ON u.id = t.user_id
         WHERE u.auth_user_id = $1 ORDER BY t.id DESC', [$authUser['id']]);
    if ($result === false) respond(500, ['error' => 'Failed to load tracks']);
    $tracks = publicMusicoTracks($result, (int) $authUser['id']);
    $order = @pg_query_params($db,
        'SELECT o.track_id FROM public.track_order o
         JOIN public."user" u ON u.id = o.user_id
         WHERE u.auth_user_id = $1 ORDER BY o.position', [$authUser['id']]);
    if ($order === false) respond(500, ['error' => 'Failed to load phone order']);
    $phoneOrder = [];
    while (($row = pg_fetch_assoc($order)) !== false) $phoneOrder[] = (int) $row['track_id'];
    $usedBytes = mediaAudioUsage(connectMediaDb(), (int) $authUser['id']);
    respond(200, [
        'tracks' => $tracks,
        'phone_order' => $phoneOrder,
        'usage' => ['bytes' => $usedBytes],
        'limits' => ['bytes' => MUSICO_USER_MAX_BYTES, 'per_file_bytes' => MUSICO_TRACK_MAX_BYTES],
    ]);
}

function handleSaveMusicoTrackOrder(array $authUser): never
{
    $body = readJsonBody(1048576);
    $ids = $body['track_ids'] ?? null;
    if (!is_array($ids) || !array_is_list($ids) || count($ids) > 50000) {
        respond(400, ['error' => 'Invalid track order']);
    }
    $seen = [];
    foreach ($ids as $id) {
        if (!is_int($id) || $id < 1 || isset($seen[$id])) {
            respond(400, ['error' => 'Invalid track order']);
        }
        $seen[$id] = true;
    }
    $db = connectMusicoDb();
    beginMusicoMutation($db, $authUser);
    $userId = ensureMusicoUserId($db, $authUser);
    $array = '{' . implode(',', $ids) . '}';
    $owned = @pg_query_params($db,
        'SELECT COUNT(*) FROM public.track WHERE user_id = $1 AND id = ANY($2::bigint[])',
        [$userId, $array]);
    if ($owned === false) respond(500, ['error' => 'Could not check track order']);
    if ((int) pg_fetch_result($owned, 0, 0) !== count($ids)) {
        respond(400, ['error' => 'Track order contains an unavailable song']);
    }
    if (@pg_query_params($db, 'DELETE FROM public.track_order WHERE user_id = $1', [$userId]) === false) {
        respond(500, ['error' => 'Could not clear track order']);
    }
    $saved = @pg_query_params($db,
        'INSERT INTO public.track_order (user_id, track_id, position)
         SELECT $1, item.track_id, item.ordinality - 1
         FROM unnest($2::bigint[]) WITH ORDINALITY AS item(track_id, ordinality)',
        [$userId, $array]);
    if ($saved === false) respond(500, ['error' => 'Could not save track order']);
    finishMusicoMutation($db);
    respond(200, ['count' => count($ids)]);
}

function handleGetMusicoTrack(array $authUser, int $id): never
{
    $db = connectMusicoDb();
    $result = @pg_query_params($db,
        'SELECT t.id, t.title, t.artist, t.media_audio_id,
                t.version, t.stats_version,
                t.album, t.genre, t.release_year, t.track_number, t.rating, t.play_count, t.listen_ms,
                t.art_image_id, ' . musicoAnalysisProjection('t') . ', t.created
         FROM public.track t JOIN public."user" u ON u.id = t.user_id
         WHERE t.id = $1 AND u.auth_user_id = $2', [$id, $authUser['id']]);
    if ($result === false) respond(500, ['error' => 'Could not load track']);
    $row = pg_fetch_assoc($result);
    if ($row === false) respond(404, ['error' => 'Track not found']);
    header('Cache-Control: private, no-store');
    header('ETag: "v' . $row['version'] . '"');
    respond(200, publicMusicoTrack($row, (int) $authUser['id']));
}

function musicoUploadRequestId(): ?string
{
    $value = $_SERVER['HTTP_IDEMPOTENCY_KEY'] ?? null;
    if ($value === null) return null;
    if (!is_string($value) || preg_match(
        '/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/D',
        $value) !== 1) respond(400, ['error' => 'Invalid Idempotency-Key']);
    return strtolower($value);
}

function requiredMusicoStatisticRequestId(): string
{
    $requestId = musicoUploadRequestId();
    if ($requestId === null) respond(428, ['error' => 'Idempotency-Key is required']);
    return $requestId;
}

function musicoStatisticResult(array $row): array
{
    return ['play_count' => (int) $row['play_count'], 'listen_ms' => (int) $row['listen_ms'],
        'stats_version' => (int) $row['stats_version']];
}

function replayMusicoStatisticRequest($db, int $userId, string $requestId,
    string $requestHash): ?array
{
    $result = @pg_query_params($db,
        'SELECT request_sha256, play_count, listen_ms, stats_version
         FROM public.track_stat_request WHERE user_id = $1 AND request_id = $2',
        [$userId, $requestId]);
    if ($result === false) respond(500, ['error' => 'Could not check statistic request']);
    $row = pg_fetch_assoc($result);
    if ($row === false) return null;
    if (!hash_equals(trim($row['request_sha256']), $requestHash)) {
        respond(409, ['error' => 'Idempotency-Key was used for a different statistic request']);
    }
    return musicoStatisticResult($row);
}

function recordMusicoStatisticRequest($db, int $userId, string $requestId,
    string $requestHash, int $trackId, array $row): void
{
    $saved = @pg_query_params($db,
        'INSERT INTO public.track_stat_request
             (user_id, request_id, request_sha256, track_id, play_count, listen_ms, stats_version)
         VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [$userId, $requestId, $requestHash, $trackId, $row['play_count'], $row['listen_ms'],
            $row['stats_version']]);
    if ($saved === false) respond(500, ['error' => 'Could not record statistic request']);
}

function recordMusicoUploadRequest($db, int $userId, ?string $requestId,
    string $requestHash, int $trackId): void
{
    if ($requestId === null) return;
    $saved = @pg_query_params($db,
        'INSERT INTO public.track_upload_request (user_id, request_id, request_sha256, track_id)
         VALUES ($1, $2, $3, $4)', [$userId, $requestId, $requestHash, $trackId]);
    if ($saved === false) respond(500, ['error' => 'Could not record upload request']);
}

function handleUploadMusicoTrack(array $authUser): never
{
    $requestId = musicoUploadRequestId();
    if ((int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > MUSICO_TRACK_MAX_BYTES + 1048576) {
        respond(413, ['error' => 'Audio file must be at most 24 MiB']);
    }
    $file = $_FILES['file'] ?? null;
    if (is_array($file) && in_array($file['error'] ?? null, [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true)) {
        respond(413, ['error' => 'Audio file must be at most 24 MiB']);
    }
    if (!is_array($file) || is_array($file['name'] ?? null) || ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK
        || !is_uploaded_file((string) ($file['tmp_name'] ?? ''))) {
        respond(400, ['error' => 'Choose an audio file']);
    }
    $name = mediaAudioName(musicoText($file['name'], 255, 'filename'));
    $size = (int) ($file['size'] ?? 0);
    if ($size < 1 || $size > MUSICO_TRACK_MAX_BYTES) respond(413, ['error' => 'Audio file must be at most 24 MiB']);
    $bytes = @file_get_contents($file['tmp_name']);
    if ($bytes === false || strlen($bytes) !== $size) respond(500, ['error' => 'Could not read audio file']);
    $mime = mediaAudioType($name, $bytes);
    if ($mime === null) respond(400, ['error' => 'Choose an MP3, Ogg, WAV, FLAC, or M4A audio file']);
    $contentSha256 = hash('sha256', $bytes);
    $title = musicoText($_POST['title'] ?? pathinfo($name, PATHINFO_FILENAME), 200, 'title');
    $artist = $_POST['artist'] ?? '';
    if (!is_string($artist) || strlen($artist) > 200 || preg_match('//u', $artist) !== 1
        || preg_match('/[\x00-\x1f\x7f]/u', $artist)) respond(400, ['error' => 'Invalid artist']);
    $artist = trim($artist);
    $album = musicoOptionalText($_POST['album'] ?? '', 'album');
    $genre = musicoOptionalText($_POST['genre'] ?? '', 'genre');
    $year = $_POST['year'] ?? null;
    $trackNumber = $_POST['track_number'] ?? null;
    if ($year !== null && (!is_string($year) || !preg_match('/^[0-9]{4}$/D', $year))) {
        respond(400, ['error' => 'Invalid year']);
    }
    if ($trackNumber !== null && (!is_string($trackNumber) || !preg_match('/^[0-9]{1,3}$/D', $trackNumber))) {
        respond(400, ['error' => 'Invalid track number']);
    }
    $year = musicoOptionalNumber($year === null ? null : (int) $year, 1800, 2100, 'year');
    $trackNumber = musicoOptionalNumber($trackNumber === null ? null : (int) $trackNumber, 1, 999, 'track number');
    $requestHash = hash('sha256', json_encode([$contentSha256, $name, $title, $artist,
        $album, $genre, $year, $trackNumber], JSON_THROW_ON_ERROR));

    $db = connectMusicoDb();
    beginMusicoMutation($db, $authUser);
    $userId = ensureMusicoUserId($db, $authUser);
    if ($requestId !== null) {
        $pruned = @pg_query_params($db,
            'DELETE FROM public.track_upload_request
             WHERE user_id = $1 AND created < CURRENT_TIMESTAMP - INTERVAL \'30 days\'', [$userId]);
        if ($pruned === false) respond(500, ['error' => 'Could not check upload request']);
        $request = @pg_query_params($db,
            'SELECT request_sha256, track_id FROM public.track_upload_request
             WHERE user_id = $1 AND request_id = $2', [$userId, $requestId]);
        if ($request === false) respond(500, ['error' => 'Could not check upload request']);
        if (($prior = pg_fetch_assoc($request)) !== false) {
            if (!hash_equals(trim($prior['request_sha256']), $requestHash)) {
                respond(409, ['error' => 'Idempotency-Key was used for a different upload']);
            }
            if ($prior['track_id'] === null) {
                respond(409, ['error' => 'The original uploaded track was deleted']);
            }
            $priorTrack = @pg_query_params($db,
                'SELECT t.id, t.title, t.artist, t.media_audio_id,
                        t.version, t.stats_version,
                        t.album, t.genre, t.release_year, t.track_number, t.rating, t.play_count, t.listen_ms,
                        t.art_image_id, ' . musicoAnalysisProjection('t') . ', t.created
                 FROM public.track t WHERE t.user_id = $1 AND t.id = $2',
                [$userId, $prior['track_id']]);
            if ($priorTrack === false) respond(500, ['error' => 'Could not load uploaded track']);
            $row = pg_fetch_assoc($priorTrack);
            if ($row === false) respond(409, ['error' => 'The original uploaded track was deleted']);
            finishMusicoMutation($db);
            respond(200, publicMusicoTrack($row, (int) $authUser['id']));
        }
    }
    $mediaFile = saveMediaAudioFile(connectMediaDb(), (int) $authUser['id'],
        $name, $mime, $bytes, $contentSha256);
    $existing = @pg_query_params($db,
        'SELECT t.id, t.title, t.artist, t.media_audio_id,
                t.version, t.stats_version,
                t.album, t.genre, t.release_year, t.track_number, t.rating, t.play_count, t.listen_ms, t.art_image_id, '
                . musicoAnalysisProjection('t') . ', t.created
         FROM public.track t WHERE t.user_id = $1 AND t.media_audio_id = $2
         ORDER BY t.id LIMIT 1', [$userId, $mediaFile['id']]);
    if ($existing === false) respond(500, ['error' => 'Could not check existing tracks']);
    if (($existingTrack = pg_fetch_assoc($existing)) !== false) {
        recordMusicoUploadRequest($db, $userId, $requestId, $requestHash, (int) $existingTrack['id']);
        finishMusicoMutation($db);
        respond(200, publicMusicoTrack($existingTrack, (int) $authUser['id'], $mediaFile));
    }
    $saved = @pg_query_params($db,
        'INSERT INTO public.track (user_id, title, artist, media_audio_id,
                                  album, genre, release_year, track_number)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, title, artist, media_audio_id,
                   version, stats_version,
                   album, genre, release_year, track_number, rating, play_count, listen_ms, art_image_id, '
                   . musicoAnalysisProjection() . ', created',
        [$userId, $title, $artist, $mediaFile['id'], $album, $genre, $year, $trackNumber]);
    if ($saved === false || ($row = pg_fetch_assoc($saved)) === false) respond(500, ['error' => 'Could not save track']);
    recordMusicoUploadRequest($db, $userId, $requestId, $requestHash, (int) $row['id']);
    recordMusicoChange($db, $authUser, 'track', (int) $row['id']);
    finishMusicoMutation($db);
    respond(201, publicMusicoTrack($row, (int) $authUser['id'], $mediaFile));
}

function handleDeleteMusicoTrack(array $authUser, int $id): never
{
    $expected = requiredMusicoVersion();
    $db = connectMusicoDb();
    beginMusicoMutation($db, $authUser);
    assertMusicoVersion($db, $authUser, 'track', $id, $expected);
    $memberships = @pg_query_params($db,
        'SELECT pt.playlist_id FROM public.playlist_track pt
         JOIN public.track t ON t.id = pt.track_id
         JOIN public."user" u ON u.id = t.user_id
         WHERE t.id = $1 AND u.auth_user_id = $2', [$id, $authUser['id']]);
    if ($memberships === false) respond(500, ['error' => 'Could not load playlist memberships']);
    $deleted = @pg_query_params($db,
        'DELETE FROM public.track t USING public."user" u
         WHERE t.id = $1 AND t.user_id = u.id AND u.auth_user_id = $2 RETURNING t.id',
        [$id, $authUser['id']]);
    if ($deleted === false) respond(500, ['error' => 'Could not delete track']);
    if (pg_num_rows($deleted) === 0) respond(404, ['error' => 'Track not found']);
    recordMusicoChange($db, $authUser, 'track', $id, 'delete');
    while (($membership = pg_fetch_assoc($memberships)) !== false) {
        $playlistId = (int) $membership['playlist_id'];
        if (@pg_query_params($db,
            'UPDATE public.playlist SET version = version + 1 WHERE id = $1', [$playlistId]) === false) {
            respond(500, ['error' => 'Could not update playlist version']);
        }
        recordMusicoChange($db, $authUser, 'playlist', $playlistId);
    }
    finishMusicoMutation($db);
    http_response_code(204);
    exit;
}

function handleCreateMusicoTrackFromMedia(array $authUser): never
{
    $body = readJsonBody();
    $audioId = $body['media_audio_id'] ?? null;
    if (!is_int($audioId) || $audioId < 1) respond(400, ['error' => 'Invalid media audio ID']);
    $db = connectMusicoDb();
    beginMusicoMutation($db, $authUser);
    $userId = ensureMusicoUserId($db, $authUser);
    $media = connectMediaDb();
    $fileResult = @pg_query_params($media,
        'SELECT id, original_name, mime_type, size_bytes, sha256 FROM public.audio_file
         WHERE id = $1 AND owner_auth_user_id = $2', [$audioId, $authUser['id']]);
    if ($fileResult === false) respond(500, ['error' => 'Could not load audio file']);
    $file = pg_fetch_assoc($fileResult);
    if ($file === false) respond(404, ['error' => 'Audio file not found']);
    $existing = @pg_query_params($db,
        'SELECT t.id, t.title, t.artist, t.media_audio_id,
                t.version, t.stats_version, t.album, t.genre, t.release_year, t.track_number,
                t.rating, t.play_count, t.listen_ms, t.art_image_id, ' . musicoAnalysisProjection('t') . ', t.created
         FROM public.track t WHERE t.user_id = $1 AND t.media_audio_id = $2', [$userId, $audioId]);
    if ($existing === false) respond(500, ['error' => 'Could not check songs']);
    if (($row = pg_fetch_assoc($existing)) !== false) {
        finishMusicoMutation($db);
        respond(200, publicMusicoTrack($row, (int) $authUser['id'], $file));
    }
    $defaultTitle = pathinfo($file['original_name'], PATHINFO_FILENAME);
    if (trim($defaultTitle) === '') $defaultTitle = $file['original_name'];
    while (strlen($defaultTitle) > 200) $defaultTitle = preg_replace('/.$/u', '', $defaultTitle);
    $title = musicoText($defaultTitle, 200, 'title');
    $saved = @pg_query_params($db,
        'INSERT INTO public.track (user_id, media_audio_id, title)
         VALUES ($1, $2, $3)
         RETURNING id, title, artist, media_audio_id,
                   version, stats_version, album, genre, release_year, track_number,
                   rating, play_count, listen_ms, art_image_id, ' . musicoAnalysisProjection() . ', created',
        [$userId, $audioId, $title]);
    if ($saved === false || ($row = pg_fetch_assoc($saved)) === false) {
        respond(500, ['error' => 'Could not add song']);
    }
    recordMusicoChange($db, $authUser, 'track', (int) $row['id']);
    finishMusicoMutation($db);
    respond(201, publicMusicoTrack($row, (int) $authUser['id'], $file));
}

function musicoOptionalText(mixed $value, string $label): string
{
    if (!is_string($value) || strlen($value) > 200 || preg_match('//u', $value) !== 1
        || preg_match('/[\x00-\x1f\x7f]/u', $value)) respond(400, ['error' => "Invalid {$label}"]);
    return trim($value);
}

function musicoOptionalNumber(mixed $value, int $min, int $max, string $label): ?int
{
    if ($value === null) return null;
    if (!is_int($value) || $value < $min || $value > $max) respond(400, ['error' => "Invalid {$label}"]);
    return $value;
}

function handleUpdateMusicoTrack(array $authUser, int $id): never
{
    $expected = requiredMusicoVersion();
    $body = readJsonBody();
    $title = musicoText($body['title'] ?? null, 200, 'title');
    $artist = musicoOptionalText($body['artist'] ?? null, 'artist');
    $album = musicoOptionalText($body['album'] ?? null, 'album');
    $genre = musicoOptionalText($body['genre'] ?? null, 'genre');
    $year = musicoOptionalNumber($body['year'] ?? null, 1800, 2100, 'year');
    $trackNumber = musicoOptionalNumber($body['track_number'] ?? null, 1, 999, 'track number');
    $rating = musicoOptionalNumber($body['rating'] ?? null, 0, 10, 'rating');
    $artImageId = musicoOptionalNumber($body['art_image_id'] ?? null, 1, PHP_INT_MAX, 'art image ID');
    $db = connectMusicoDb();
    beginMusicoMutation($db, $authUser);
    assertMusicoVersion($db, $authUser, 'track', $id, $expected);
    $mediaDb = null;
    if ($artImageId !== null) {
        if (@pg_query_params($db, 'SELECT pg_advisory_xact_lock($1::bigint)', [-$artImageId]) === false) {
            respond(500, ['error' => 'Could not check album art']);
        }
        $mediaDb = connectMediaDb();
        $image = @pg_query_params($mediaDb,
            'SELECT 1 FROM public.image WHERE id = $1 AND (owner_auth_user_id = $2 OR shared = TRUE)',
            [$artImageId, $authUser['id']]);
        if ($image === false) respond(500, ['error' => 'Could not check album art']);
        if (pg_num_rows($image) === 0) respond(400, ['error' => 'Choose album art from your image library']);
    }
    $updated = @pg_query_params($db,
        'UPDATE public.track t SET title = $1, artist = $2, album = $3, genre = $4,
             release_year = $5, track_number = $6, rating = $7, art_image_id = $8,
             version = t.version + 1
         FROM public."user" u WHERE t.id = $9 AND t.user_id = u.id AND u.auth_user_id = $10
         RETURNING t.id, t.title, t.artist, t.media_audio_id,
                   t.version, t.stats_version,
                   t.album, t.genre, t.release_year, t.track_number, t.rating, t.play_count, t.listen_ms, t.art_image_id, '
                   . musicoAnalysisProjection('t') . ', t.created',
        [$title, $artist, $album, $genre, $year, $trackNumber, $rating, $artImageId, $id, $authUser['id']]);
    if ($updated === false) respond(500, ['error' => 'Could not update track']);
    $row = pg_fetch_assoc($updated);
    if ($row === false) respond(404, ['error' => 'Track not found']);
    recordMusicoChange($db, $authUser, 'track', $id);
    finishMusicoMutation($db);
    if ($mediaDb !== null) {
        try {
            renameGenericMusicoArtwork($mediaDb, $artImageId, (int) $authUser['id'],
                $artist, $album, $title);
        } catch (RuntimeException $error) {
            error_log($error->getMessage());
        }
    }
    header('ETag: "v' . $row['version'] . '"');
    respond(200, publicMusicoTrack($row, (int) $authUser['id']));
}

function musicoAnalysisInteger(array $body, string $key, int $min, int $max): ?int
{
    if (!array_key_exists($key, $body)) respond(400, ['error' => "Missing {$key}"]);
    return musicoOptionalNumber($body[$key], $min, $max, $key);
}

function musicoAnalysisDecimal(array $body, string $key, float $min, float $max): ?float
{
    if (!array_key_exists($key, $body)) respond(400, ['error' => "Missing {$key}"]);
    $value = $body[$key];
    if ($value === null) return null;
    if ((!is_int($value) && !is_float($value)) || !is_finite((float) $value)
        || $value < $min || $value > $max) respond(400, ['error' => "Invalid {$key}"]);
    return round((float) $value, 2);
}

function musicoAnalysisText(array $body, string $key, int $maxBytes): ?string
{
    if (!array_key_exists($key, $body)) respond(400, ['error' => "Missing {$key}"]);
    return $body[$key] === null ? null : musicoText($body[$key], $maxBytes, $key);
}

function handleSaveMusicoTrackAnalysis(array $authUser, int $id): never
{
    $expected = requiredMusicoVersion();
    $body = readJsonBody();
    if ($body === null) respond(400, ['error' => 'Invalid analysis']);
    $keys = array_slice(MUSICO_ANALYSIS_COLUMNS, 0, -1);
    foreach (array_keys($body) as $key) {
        if (!in_array($key, $keys, true)) respond(400, ['error' => "Unknown {$key}"]);
    }
    $analysis = [
        'duration_ms' => musicoAnalysisInteger($body, 'duration_ms', 0, 86400000),
        'bit_rate' => musicoAnalysisInteger($body, 'bit_rate', 1, 1000000000),
        'sample_rate_hz' => musicoAnalysisInteger($body, 'sample_rate_hz', 1, 1000000),
        'bit_depth' => musicoAnalysisInteger($body, 'bit_depth', 1, 64),
        'channels' => musicoAnalysisInteger($body, 'channels', 1, 64),
        'codec' => musicoAnalysisText($body, 'codec', 100),
        'estimated_bpm' => musicoAnalysisInteger($body, 'estimated_bpm', 30, 300),
        'estimated_key' => musicoAnalysisText($body, 'estimated_key', 32),
        'peak_db' => musicoAnalysisDecimal($body, 'peak_db', -200, 20),
        'average_db' => musicoAnalysisDecimal($body, 'average_db', -200, 20),
        'dynamic_range_db' => musicoAnalysisDecimal($body, 'dynamic_range_db', 0, 220),
    ];
    $db = connectMusicoDb();
    beginMusicoMutation($db, $authUser);
    assertMusicoVersion($db, $authUser, 'track', $id, $expected);
    $assignments = [];
    foreach (array_keys($analysis) as $index => $column) {
        $assignments[] = $column . ' = $' . ($index + 1);
    }
    $values = array_values($analysis);
    $trackPlaceholder = '$' . (count($values) + 1);
    $values[] = $id;
    $userPlaceholder = '$' . (count($values) + 1);
    $values[] = $authUser['id'];
    $updated = @pg_query_params($db,
        'UPDATE public.track t SET ' . implode(', ', $assignments) . ', analysis_saved_at = CURRENT_TIMESTAMP,
             version = t.version + 1
         FROM public."user" u WHERE t.id = ' . $trackPlaceholder . ' AND t.user_id = u.id
            AND u.auth_user_id = ' . $userPlaceholder . '
         RETURNING ' . musicoAnalysisProjection('t') . ', t.version', $values);
    if ($updated === false) respond(500, ['error' => 'Could not save analysis']);
    $row = pg_fetch_assoc($updated);
    if ($row === false) respond(404, ['error' => 'Track not found']);
    recordMusicoChange($db, $authUser, 'track', $id);
    finishMusicoMutation($db);
    header('ETag: "v' . $row['version'] . '"');
    respond(200, ['analysis' => publicMusicoAnalysis($row), 'version' => (int) $row['version']]);
}

function handleRecordMusicoListen(array $authUser, int $id): never
{
    $requestId = requiredMusicoStatisticRequestId();
    $body = readJsonBody();
    $started = $body['started'] ?? false;
    $milliseconds = $body['milliseconds'] ?? 0;
    if (!is_bool($started) || !is_int($milliseconds) || $milliseconds < 0 || $milliseconds > 60000
        || (!$started && $milliseconds === 0)) respond(400, ['error' => 'Invalid listening activity']);
    $requestHash = hash('sha256', json_encode(['listen', $id, $started, $milliseconds], JSON_THROW_ON_ERROR));
    $db = connectMusicoDb();
    beginMusicoMutation($db, $authUser);
    $userId = ensureMusicoUserId($db, $authUser);
    $prior = replayMusicoStatisticRequest($db, $userId, $requestId, $requestHash);
    if ($prior !== null) {
        finishMusicoMutation($db);
        header('ETag: "s' . $prior['stats_version'] . '"');
        respond(200, $prior);
    }
    $updated = @pg_query_params($db,
        'UPDATE public.track t SET play_count = play_count + $1, listen_ms = listen_ms + $2,
             stats_version = t.stats_version + 1
         FROM public."user" u WHERE t.id = $3 AND t.user_id = u.id AND u.auth_user_id = $4
         RETURNING t.play_count, t.listen_ms, t.stats_version',
        [$started ? 1 : 0, $milliseconds, $id, $authUser['id']]);
    if ($updated === false) respond(500, ['error' => 'Could not record listening activity']);
    $row = pg_fetch_assoc($updated);
    if ($row === false) respond(404, ['error' => 'Track not found']);
    recordMusicoStatisticRequest($db, $userId, $requestId, $requestHash, $id, $row);
    recordMusicoChange($db, $authUser, 'track', $id);
    finishMusicoMutation($db);
    header('ETag: "s' . $row['stats_version'] . '"');
    respond(200, musicoStatisticResult($row));
}

function handleRestoreMusicoTrackStats(array $authUser, int $id): never
{
    $requestId = requiredMusicoStatisticRequestId();
    $expected = requiredMusicoVersion('s');
    $body = readJsonBody();
    $plays = $body['play_count'] ?? null;
    $milliseconds = $body['listen_ms'] ?? null;
    if (!is_int($plays) || $plays < 0 || $plays > 1000000000
        || !is_int($milliseconds) || $milliseconds < 0 || $milliseconds > 1000000000000000) {
        respond(400, ['error' => 'Invalid listening statistics']);
    }
    $requestHash = hash('sha256', json_encode(['restore', $id, $expected, $plays, $milliseconds],
        JSON_THROW_ON_ERROR));
    $db = connectMusicoDb();
    beginMusicoMutation($db, $authUser);
    $userId = ensureMusicoUserId($db, $authUser);
    $prior = replayMusicoStatisticRequest($db, $userId, $requestId, $requestHash);
    if ($prior !== null) {
        finishMusicoMutation($db);
        header('ETag: "s' . $prior['stats_version'] . '"');
        respond(200, $prior);
    }
    assertMusicoVersion($db, $authUser, 'track', $id, $expected, true);
    $updated = @pg_query_params($db,
        'UPDATE public.track t SET play_count = $1, listen_ms = $2,
             stats_version = t.stats_version + 1
         FROM public."user" u WHERE t.id = $3 AND t.user_id = u.id AND u.auth_user_id = $4
         RETURNING t.play_count, t.listen_ms, t.stats_version',
        [$plays, $milliseconds, $id, $authUser['id']]);
    if ($updated === false) respond(500, ['error' => 'Could not restore listening statistics']);
    $row = pg_fetch_assoc($updated);
    if ($row === false) respond(404, ['error' => 'Track not found']);
    recordMusicoStatisticRequest($db, $userId, $requestId, $requestHash, $id, $row);
    recordMusicoChange($db, $authUser, 'track', $id);
    finishMusicoMutation($db);
    header('ETag: "s' . $row['stats_version'] . '"');
    respond(200, musicoStatisticResult($row));
}

function handleStreamMusicoTrack(array $authUser, int $id): never
{
    $db = connectMusicoDb();
    $result = @pg_query_params($db,
        'SELECT t.media_audio_id FROM public.track t
         JOIN public."user" u ON u.id = t.user_id
         WHERE t.id = $1 AND u.auth_user_id = $2', [$id, $authUser['id']]);
    if ($result === false) respond(500, ['error' => 'Could not load track']);
    $track = pg_fetch_assoc($result);
    if ($track === false) respond(404, ['error' => 'Track not found']);
    streamMediaAudio(connectMediaDb(), (int) $track['media_audio_id'], (int) $authUser['id']);
}

function publicMusicoPlaylist(array $row): array
{
    return [
        'id' => (int) $row['id'], 'name' => $row['name'],
        'track_count' => (int) $row['track_count'], 'version' => (int) $row['version'],
        'created' => $row['created'],
    ];
}

function handleListMusicoPlaylists(array $authUser): never
{
    $db = connectMusicoDb();
    $result = @pg_query_params($db,
        'SELECT p.id, p.name, p.created, p.version,
            (SELECT COUNT(*) FROM public.playlist_track pt WHERE pt.playlist_id = p.id) AS track_count
         FROM public.playlist p JOIN public."user" u ON u.id = p.user_id
         WHERE u.auth_user_id = $1 ORDER BY p.id DESC', [$authUser['id']]);
    if ($result === false) respond(500, ['error' => 'Could not load playlists']);
    $playlists = [];
    while (($row = pg_fetch_assoc($result)) !== false) $playlists[] = publicMusicoPlaylist($row);
    respond(200, ['playlists' => $playlists]);
}

function handleCreateMusicoPlaylist(array $authUser): never
{
    $body = readJsonBody();
    $name = musicoText($body['name'] ?? null, 100, 'playlist name');
    $requestId = musicoUploadRequestId();
    $db = connectMusicoDb();
    beginMusicoMutation($db, $authUser);
    $userId = ensureMusicoUserId($db, $authUser);
    if ($requestId !== null) {
        $prior = @pg_query_params($db,
            'SELECT r.request_name, r.playlist_id, p.id, p.name, p.created, p.version,
                    (SELECT COUNT(*) FROM public.playlist_track pt WHERE pt.playlist_id = p.id) AS track_count
             FROM public.playlist_create_request r
             LEFT JOIN public.playlist p ON p.id = r.playlist_id
             WHERE r.user_id = $1 AND r.request_id = $2', [$userId, $requestId]);
        if ($prior === false) respond(500, ['error' => 'Could not check playlist creation request']);
        $priorRow = pg_fetch_assoc($prior);
        if ($priorRow !== false) {
            if ($priorRow['request_name'] !== $name || $priorRow['playlist_id'] === null) {
                respond(409, ['error' => 'Idempotency-Key was used for a different or deleted playlist']);
            }
            finishMusicoMutation($db);
            header('ETag: "v' . $priorRow['version'] . '"');
            respond(200, publicMusicoPlaylist($priorRow));
        }
    }
    $saved = @pg_query_params($db,
        'INSERT INTO public.playlist (user_id, name) VALUES ($1, $2)
         RETURNING id, name, created, version', [$userId, $name]);
    if ($saved === false || ($row = pg_fetch_assoc($saved)) === false) respond(500, ['error' => 'Could not create playlist']);
    if ($requestId !== null && @pg_query_params($db,
        'INSERT INTO public.playlist_create_request (user_id, request_id, request_name, playlist_id)
         VALUES ($1, $2, $3, $4)', [$userId, $requestId, $name, $row['id']]) === false) {
        respond(500, ['error' => 'Could not save playlist creation request']);
    }
    recordMusicoChange($db, $authUser, 'playlist', (int) $row['id']);
    finishMusicoMutation($db);
    $row['track_count'] = 0;
    header('ETag: "v' . $row['version'] . '"');
    respond(201, publicMusicoPlaylist($row));
}

function handleGetMusicoPlaylist(array $authUser, int $id): never
{
    $db = connectMusicoDb();
    $result = @pg_query_params($db,
        'SELECT p.id, p.name, p.created, p.version,
            (SELECT COUNT(*) FROM public.playlist_track pt WHERE pt.playlist_id = p.id) AS track_count
         FROM public.playlist p JOIN public."user" u ON u.id = p.user_id
         WHERE p.id = $1 AND u.auth_user_id = $2', [$id, $authUser['id']]);
    if ($result === false) respond(500, ['error' => 'Could not load playlist']);
    $playlist = pg_fetch_assoc($result);
    if ($playlist === false) respond(404, ['error' => 'Playlist not found']);
    $tracks = @pg_query_params($db,
        'SELECT t.id, t.title, t.artist, t.media_audio_id,
                t.version, t.stats_version,
                t.album, t.genre, t.release_year, t.track_number, t.rating, t.play_count, t.listen_ms, t.art_image_id, '
                . musicoAnalysisProjection('t') . ', t.created
         FROM public.playlist_track pt JOIN public.track t ON t.id = pt.track_id
         WHERE pt.playlist_id = $1 ORDER BY pt.position, t.id', [$id]);
    if ($tracks === false) respond(500, ['error' => 'Could not load playlist tracks']);
    $items = publicMusicoTracks($tracks, (int) $authUser['id']);
    header('ETag: "v' . $playlist['version'] . '"');
    respond(200, ['playlist' => publicMusicoPlaylist($playlist), 'tracks' => $items]);
}

function handleRenameMusicoPlaylist(array $authUser, int $id): never
{
    $expected = requiredMusicoVersion();
    $body = readJsonBody();
    $name = musicoText($body['name'] ?? null, 100, 'playlist name');
    $db = connectMusicoDb();
    beginMusicoMutation($db, $authUser);
    assertMusicoVersion($db, $authUser, 'playlist', $id, $expected);
    $updated = @pg_query_params($db,
        'UPDATE public.playlist p SET name = $1, version = p.version + 1 FROM public."user" u
         WHERE p.id = $2 AND p.user_id = u.id AND u.auth_user_id = $3
         RETURNING p.id, p.name, p.created, p.version,
            (SELECT COUNT(*) FROM public.playlist_track pt WHERE pt.playlist_id = p.id) AS track_count',
        [$name, $id, $authUser['id']]);
    if ($updated === false) respond(500, ['error' => 'Could not rename playlist']);
    $row = pg_fetch_assoc($updated);
    if ($row === false) respond(404, ['error' => 'Playlist not found']);
    recordMusicoChange($db, $authUser, 'playlist', $id);
    finishMusicoMutation($db);
    header('ETag: "v' . $row['version'] . '"');
    respond(200, publicMusicoPlaylist($row));
}

function handleDeleteMusicoPlaylist(array $authUser, int $id): never
{
    $expected = requiredMusicoVersion();
    $db = connectMusicoDb();
    beginMusicoMutation($db, $authUser);
    assertMusicoVersion($db, $authUser, 'playlist', $id, $expected);
    $deleted = @pg_query_params($db,
        'DELETE FROM public.playlist p USING public."user" u
         WHERE p.id = $1 AND p.user_id = u.id AND u.auth_user_id = $2 RETURNING p.id',
        [$id, $authUser['id']]);
    if ($deleted === false) respond(500, ['error' => 'Could not delete playlist']);
    if (pg_num_rows($deleted) === 0) respond(404, ['error' => 'Playlist not found']);
    recordMusicoChange($db, $authUser, 'playlist', $id, 'delete');
    finishMusicoMutation($db);
    http_response_code(204);
    exit;
}

function handleAddMusicoPlaylistTrack(array $authUser, int $playlistId): never
{
    $expected = requiredMusicoVersion();
    $body = readJsonBody();
    $trackId = filter_var($body['track_id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    if ($trackId === false) respond(400, ['error' => 'Invalid track ID']);
    $db = connectMusicoDb();
    beginMusicoMutation($db, $authUser);
    assertMusicoVersion($db, $authUser, 'playlist', $playlistId, $expected);
    $saved = @pg_query_params($db,
        'INSERT INTO public.playlist_track (playlist_id, track_id, position)
         SELECT p.id, t.id,
            COALESCE((SELECT MAX(position) FROM public.playlist_track WHERE playlist_id = p.id), 0) + 1
         FROM public.playlist p JOIN public.track t ON t.user_id = p.user_id
         JOIN public."user" u ON u.id = p.user_id
         WHERE p.id = $1 AND t.id = $2 AND u.auth_user_id = $3
         ON CONFLICT (playlist_id, track_id) DO NOTHING RETURNING track_id',
        [$playlistId, $trackId, $authUser['id']]);
    if ($saved === false) respond(500, ['error' => 'Could not add track to playlist']);
    if (pg_num_rows($saved) === 0) {
        $exists = @pg_query_params($db,
            'SELECT 1 FROM public.playlist p JOIN public."user" u ON u.id = p.user_id
             JOIN public.track t ON t.user_id = u.id
             WHERE p.id = $1 AND t.id = $2 AND u.auth_user_id = $3',
            [$playlistId, $trackId, $authUser['id']]);
        if ($exists === false) respond(500, ['error' => 'Could not add track to playlist']);
        if (pg_num_rows($exists) === 0) respond(404, ['error' => 'Playlist or track not found']);
        respond(409, ['error' => 'Track is already in this playlist']);
    }
    $version = @pg_query_params($db,
        'UPDATE public.playlist SET version = version + 1 WHERE id = $1 RETURNING version', [$playlistId]);
    if ($version === false || pg_num_rows($version) !== 1) respond(500, ['error' => 'Could not update playlist version']);
    $currentVersion = (int) pg_fetch_result($version, 0, 0);
    recordMusicoChange($db, $authUser, 'playlist', $playlistId);
    finishMusicoMutation($db);
    header('ETag: "v' . $currentVersion . '"');
    respond(201, ['track_id' => $trackId, 'version' => $currentVersion]);
}

function handleReplaceMusicoPlaylistTracks(array $authUser, int $playlistId): never
{
    $expected = requiredMusicoVersion();
    $body = readJsonBody(262144);
    $trackIds = $body['track_ids'] ?? null;
    if (!is_array($trackIds) || !array_is_list($trackIds)
        || count($trackIds) !== count(array_unique($trackIds))
        || count(array_filter($trackIds, static fn ($id): bool => !is_int($id) || $id < 1)) > 0) {
        respond(400, ['error' => 'Invalid track IDs']);
    }
    $db = connectMusicoDb();
    beginMusicoMutation($db, $authUser);
    assertMusicoVersion($db, $authUser, 'playlist', $playlistId, $expected);
    $ids = '{' . implode(',', $trackIds) . '}';
    $owned = @pg_query_params($db,
        'SELECT COUNT(*) FROM public.track t JOIN public."user" u ON u.id = t.user_id
         WHERE u.auth_user_id = $1 AND t.id = ANY($2::bigint[])',
        [$authUser['id'], $ids]);
    if ($owned === false) respond(500, ['error' => 'Could not check playlist tracks']);
    if ((int) pg_fetch_result($owned, 0, 0) !== count($trackIds)) {
        respond(404, ['error' => 'Track not found in your library']);
    }
    if (@pg_query_params($db, 'DELETE FROM public.playlist_track WHERE playlist_id = $1',
        [$playlistId]) === false
        || @pg_query_params($db,
            'INSERT INTO public.playlist_track (playlist_id, track_id, position)
             SELECT $1, requested.track_id, requested.position::integer
             FROM unnest($2::bigint[]) WITH ORDINALITY AS requested(track_id, position)',
            [$playlistId, $ids]) === false) {
        respond(500, ['error' => 'Could not replace playlist tracks']);
    }
    $updated = @pg_query_params($db,
        'UPDATE public.playlist SET version = version + 1 WHERE id = $1 RETURNING version',
        [$playlistId]);
    if ($updated === false || pg_num_rows($updated) !== 1) {
        respond(500, ['error' => 'Could not update playlist version']);
    }
    $version = (int) pg_fetch_result($updated, 0, 0);
    recordMusicoChange($db, $authUser, 'playlist', $playlistId);
    finishMusicoMutation($db);
    header('ETag: "v' . $version . '"');
    respond(200, ['track_ids' => $trackIds, 'version' => $version]);
}

function handleRemoveMusicoPlaylistTrack(array $authUser, int $playlistId, int $trackId): never
{
    $expected = requiredMusicoVersion();
    $db = connectMusicoDb();
    beginMusicoMutation($db, $authUser);
    assertMusicoVersion($db, $authUser, 'playlist', $playlistId, $expected);
    $deleted = @pg_query_params($db,
        'DELETE FROM public.playlist_track pt USING public.playlist p, public."user" u
         WHERE pt.playlist_id = p.id AND p.user_id = u.id
           AND p.id = $1 AND pt.track_id = $2 AND u.auth_user_id = $3 RETURNING pt.track_id',
        [$playlistId, $trackId, $authUser['id']]);
    if ($deleted === false) respond(500, ['error' => 'Could not remove track']);
    if (pg_num_rows($deleted) === 0) respond(404, ['error' => 'Playlist track not found']);
    if (@pg_query_params($db,
        'UPDATE public.playlist SET version = version + 1 WHERE id = $1', [$playlistId]) === false) {
        respond(500, ['error' => 'Could not update playlist version']);
    }
    recordMusicoChange($db, $authUser, 'playlist', $playlistId);
    finishMusicoMutation($db);
    http_response_code(204);
    exit;
}
