<?php
declare(strict_types=1);

function musicoAudioFiles(array $rows, int|array $authUserId): array
{
    $ids = array_values(array_unique(array_map(static fn (array $row): int =>
        (int) $row['media_audio_id'], $rows)));
    if ($ids === []) return [];
    $result = @pg_query_params(connectMediaDb(),
        'SELECT id, original_name, mime_type, size_bytes, sha256
         FROM public.audio_file WHERE owner_auth_user_id = ANY($1::bigint[]) AND id = ANY($2::bigint[])',
        ['{' . implode(',', (array) $authUserId) . '}', '{' . implode(',', $ids) . '}']);
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

function publicMusicoTracks($result, int|array $authUserId): array
{
    $rows = [];
    while (($row = pg_fetch_assoc($result)) !== false) $rows[] = $row;
    $files = musicoAudioFiles($rows, $authUserId);
    return array_map(static fn (array $row): array => publicMusicoTrack(
        $row, (int) ((array) $authUserId)[0], $files[(int) $row['media_audio_id']]), $rows);
}

function handleListMusicoTracks(array $authUser): never
{
    $db = connectAppDb('musico');
    $result = @pg_query_params($db,
        'SELECT t.id, t.title, t.artist, t.media_audio_id,
                t.version, t.stats_version,
                t.album, t.genre, t.release_year, t.track_number, t.rating, t.play_count, t.listen_ms, t.art_image_id, '
                . musicoAnalysisProjection('t') . ', t.created
         FROM public.track t JOIN public."user" u ON u.id = t.user_id
         WHERE u.auth_user_id = $1 OR (u.auth_user_id = $2
            AND ($3::boolean OR EXISTS (SELECT 1 FROM public.playlist_track pt
                WHERE pt.track_id = t.id AND pt.playlist_id = ANY($4::bigint[]))))
         ORDER BY t.id DESC',
        [$authUser['service_account_id'] ?? $authUser['id'], $authUser['service_owner_id'] ?? null,
         tokenOwnerAccess($authUser, 'musico') !== null ? 't' : 'f',
         '{' . implode(',', tokenOwnerResourceIds($authUser, 'musico')) . '}']);
    if ($result === false) respond(500, ['error' => 'Failed to load tracks']);
    $trackOwners = [(int) ($authUser['service_account_id'] ?? $authUser['id'])];
    if (($authUser['service_owner_id'] ?? null) !== null) $trackOwners[] = (int) $authUser['service_owner_id'];
    $tracks = publicMusicoTracks($result, $trackOwners);
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
    $db = connectAppDb('musico');
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
    $db = connectAppDb('musico');
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

function handleStreamMusicoTrack(array $authUser, int $id): never
{
    $db = connectAppDb('musico');
    $result = @pg_query_params($db,
        'SELECT t.media_audio_id FROM public.track t
         JOIN public."user" u ON u.id = t.user_id
         WHERE t.id = $1 AND u.auth_user_id = $2', [$id, $authUser['id']]);
    if ($result === false) respond(500, ['error' => 'Could not load track']);
    $track = pg_fetch_assoc($result);
    if ($track === false) respond(404, ['error' => 'Track not found']);
    streamMediaAudio(connectMediaDb(), (int) $track['media_audio_id'], (int) $authUser['id']);
}

