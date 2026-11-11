<?php
declare(strict_types=1);

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
            'SELECT shared FROM public.image WHERE id = $1 AND (owner_auth_user_id = $2 OR shared = TRUE)',
            [$artImageId, $authUser['id']]);
        if ($image === false) respond(500, ['error' => 'Could not check album art']);
        if (pg_num_rows($image) === 0) respond(400, ['error' => 'Choose album art from your image library']);
        if (($authUser['api_token_id'] ?? null) !== null
            && (int) $authUser['id'] === (int) $authUser['service_owner_id']
            && pg_fetch_result($image, 0, 'shared') !== 't'
            && !tokenOwnerImageUsable($artImageId, $authUser, 'musico')) {
            respond(403, ['error' => 'Image is outside this token\'s playlists']);
        }
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

