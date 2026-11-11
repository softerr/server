<?php
declare(strict_types=1);

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
         WHERE u.auth_user_id = $1 OR (u.auth_user_id = $2
            AND ($3::boolean OR p.id = ANY($4::bigint[]))) ORDER BY p.id DESC',
        [$authUser['service_account_id'] ?? $authUser['id'], $authUser['service_owner_id'] ?? null,
         tokenOwnerAccess($authUser, 'musico') !== null ? 't' : 'f',
         '{' . implode(',', tokenOwnerResourceIds($authUser, 'musico')) . '}']);
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
    if (($authUser['api_token_id'] ?? null) !== null
        && (int) $authUser['id'] === (int) $authUser['service_owner_id']
        && !musicoOwnerTrackGranted($authUser, (int) $trackId, false)) {
        respond(403, ['error' => 'Song is outside this token\'s playlists']);
    }
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
    if (($authUser['api_token_id'] ?? null) !== null
        && (int) $authUser['id'] === (int) $authUser['service_owner_id']) {
        foreach ($trackIds as $trackId) {
            if (!musicoOwnerTrackGranted($authUser, $trackId, false)) {
                respond(403, ['error' => 'Song is outside this token\'s playlists']);
            }
        }
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
