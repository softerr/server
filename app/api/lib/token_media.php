<?php
declare(strict_types=1);

function tokenUploadedOwnerImage(int $imageId, array $user, ?string $app = null): bool
{
    $ownerId = $user['service_owner_id'] ?? null;
    if ($ownerId === null) return false;
    $serviceId = $user['service_account_id'] ?? $user['id'];
    $result = @pg_query_params(connectMediaDb(),
        'SELECT app, resource_id FROM public.api_token_image_access
         WHERE service_auth_user_id = $1 AND image_id = $2',
        [$serviceId, $imageId]);
    if ($result === false) respond(500, ['error' => 'Failed to check token image']);
    while (($row = pg_fetch_assoc($result)) !== false) {
        if ($app !== null && $row['app'] !== $app) continue;
        $resourceId = (int) $row['resource_id'];
        if (tokenOwnerAccess($user, $row['app'], $resourceId === 0 ? null : $resourceId) !== null) {
            return true;
        }
    }
    return false;
}

function tokenReferencedOwnerImage(int $imageId, array $user, string $app): bool
{
    $ownerId = $user['service_owner_id'] ?? null;
    if ($ownerId === null || (tokenOwnerAccess($user, $app) === null
        && tokenOwnerResourceIds($user, $app) === [])) return false;
    $all = tokenOwnerAccess($user, $app) !== null ? 't' : 'f';
    $ids = '{' . implode(',', tokenOwnerResourceIds($user, $app)) . '}';
    if ($app === 'musico') {
        $result = @pg_query_params(connectMusicoDb(),
            'SELECT 1 FROM public.track t JOIN public."user" u ON u.id = t.user_id
             WHERE u.auth_user_id = $1 AND t.art_image_id = $2
               AND ($3::boolean OR EXISTS (SELECT 1 FROM public.playlist_track pt
                   WHERE pt.track_id = t.id AND pt.playlist_id = ANY($4::bigint[]))) LIMIT 1',
            [$ownerId, $imageId, $all, $ids]);
    } elseif ($app === 'mdb') {
        $result = @pg_query_params(connectMdbDb(),
            'SELECT 1 FROM public.database_cell v
             JOIN public.database_column c ON c.id = v.column_id AND c.database_id = v.database_id
             JOIN public.user_database d ON d.id = v.database_id
             JOIN public."user" u ON u.id = d.user_id
             WHERE u.auth_user_id = $1 AND c.type = \'image\' AND v.value = $2::text
               AND ($3::boolean OR d.id = ANY($4::bigint[])) LIMIT 1',
            [$ownerId, $imageId, $all, $ids]);
    } else {
        return false;
    }
    if ($result === false) respond(500, ['error' => 'Failed to check app image']);
    return pg_num_rows($result) > 0;
}

function tokenOwnerImageUsable(int $imageId, array $user, string $app): bool
{
    return tokenUploadedOwnerImage($imageId, $user, $app)
        || tokenReferencedOwnerImage($imageId, $user, $app);
}
