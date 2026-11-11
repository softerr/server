<?php
declare(strict_types=1);

function handleRecordMusicoListen(array $authUser, int $id): never
{
    $requestId = requiredMusicoStatisticRequestId();
    $body = readJsonBody();
    $started = $body['started'] ?? false;
    $milliseconds = $body['milliseconds'] ?? 0;
    if (!is_bool($started) || !is_int($milliseconds) || $milliseconds < 0 || $milliseconds > 60000
        || (!$started && $milliseconds === 0)) respond(400, ['error' => 'Invalid listening activity']);
    $requestHash = hash('sha256', json_encode(['listen', $id, $started, $milliseconds], JSON_THROW_ON_ERROR));
    $db = connectAppDb('musico');
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
    $db = connectAppDb('musico');
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

