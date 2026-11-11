<?php
declare(strict_types=1);

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
        $db = connectAppDb('musico');
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
    $db = connectAppDb('musico');
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

