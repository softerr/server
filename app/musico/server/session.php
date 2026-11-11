<?php
declare(strict_types=1);

function musicoTrackAccessUser(array $user, int $trackId, bool $write): array
{
    if (($user['service_owner_id'] ?? null) !== null) {
        $result = @pg_query_params(connectAppDb('musico'),
            'SELECT u.auth_user_id FROM public.track t JOIN public."user" u ON u.id = t.user_id WHERE t.id = $1',
            [$trackId]);
        if ($result === false) respond(500, ['error' => 'Failed to check song owner']);
        if (pg_num_rows($result) > 0
            && pg_fetch_result($result, 0, 0) === (string) $user['id']) return $user;
    }
    $all = appAccessUser($user, 'musico', $write);
    if (($user['service_owner_id'] ?? null) === null || $all['id'] !== $user['id']) return $all;
    if (musicoOwnerTrackGranted($user, $trackId, $write)) {
        $user['id'] = (int) $user['service_owner_id'];
        return $user;
    }
    if ($write && musicoOwnerTrackGranted($user, $trackId, false)) {
        respond(403, ['error' => 'API token cannot edit this song']);
    }
    return $user;
}

function musicoOwnerTrackGranted(array $user, int $trackId, bool $edit): bool
{
    if (($user['service_owner_id'] ?? null) === null) return false;
    if (tokenOwnerAccess($user, 'musico', null, $edit) !== null) return true;
    if (tokenOwnerResourceIds($user, 'musico') === []) return false;
    $result = @pg_query_params(connectAppDb('musico'),
        'SELECT p.id FROM public.track t
         JOIN public.playlist_track pt ON pt.track_id = t.id
         JOIN public.playlist p ON p.id = pt.playlist_id
         JOIN public."user" u ON u.id = t.user_id
         WHERE t.id = $1 AND u.auth_user_id = $2', [$trackId, $user['service_owner_id']]);
    if ($result === false) respond(500, ['error' => 'Failed to check song access']);
    while (($row = pg_fetch_assoc($result)) !== false) {
        if (tokenOwnerAccess($user, 'musico', (int) $row['id'], $edit) !== null) return true;
    }
    return false;
}

function musicoOwnerAudioIds(array $user, bool $edit = false): array
{
    if (($user['service_owner_id'] ?? null) === null) return [];
    $ids = array_map(static fn (array $resource): int => (int) $resource['id'],
        array_filter($user['token_access']['musico']['resources'] ?? [],
            static fn (array $resource): bool => !$edit || $resource['permission'] === 'edit'));
    if ($ids === []) return [];
    $result = @pg_query_params(connectAppDb('musico'),
        'SELECT DISTINCT t.media_audio_id FROM public.track t
         JOIN public.playlist_track pt ON pt.track_id = t.id
         JOIN public.playlist p ON p.id = pt.playlist_id
         JOIN public."user" u ON u.id = t.user_id
         WHERE u.auth_user_id = $1 AND p.id = ANY($2::bigint[])',
        [$user['service_owner_id'], '{' . implode(',', $ids) . '}']);
    if ($result === false) respond(500, ['error' => 'Failed to check song access']);
    $audioIds = [];
    while (($row = pg_fetch_assoc($result)) !== false) $audioIds[] = (int) $row['media_audio_id'];
    return $audioIds;
}

function musicoAudioAccessUser(array $user, int $audioId, bool $write): array
{
    if (($user['service_owner_id'] ?? null) !== null) {
        $result = @pg_query_params(connectMediaDb(),
            'SELECT owner_auth_user_id FROM public.audio_file WHERE id = $1', [$audioId]);
        if ($result === false) respond(500, ['error' => 'Failed to check audio owner']);
        if (pg_num_rows($result) > 0
            && pg_fetch_result($result, 0, 0) === (string) $user['id']) return $user;
    }
    $all = appAccessUser($user, 'musico', $write);
    if (($user['service_owner_id'] ?? null) === null || $all['id'] !== $user['id']) return $all;
    if (!in_array($audioId, musicoOwnerAudioIds($user), true)) return $user;
    if ($write && !in_array($audioId, musicoOwnerAudioIds($user, true), true)) {
        respond(403, ['error' => 'API token cannot edit this song audio']);
    }
    $user['id'] = (int) $user['service_owner_id'];
    return $user;
}

