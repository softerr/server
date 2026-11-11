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
    $definition = TOKEN_APPS[$app] ?? null;
    $query = $definition['owner_image_reference_sql'] ?? null;
    if (!is_string($query)) return false;
    $result = @pg_query_params(connectAppDb($definition['database']), $query,
        [$ownerId, $imageId, $all, $ids]);
    if ($result === false) respond(500, ['error' => 'Failed to check app image']);
    return pg_num_rows($result) > 0;
}

function tokenOwnerImageUsable(int $imageId, array $user, string $app): bool
{
    return tokenUploadedOwnerImage($imageId, $user, $app)
        || tokenReferencedOwnerImage($imageId, $user, $app);
}
