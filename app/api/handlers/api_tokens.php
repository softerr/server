<?php
declare(strict_types=1);

require_once __DIR__ . '/../lib/token_apps.php';
const API_TOKEN_MAX_RESOURCE_GRANTS = 1000;

function validatedTokenAccess(int $ownerId, mixed $input): array
{
    if (!is_array($input) || count(array_diff(array_keys($input), array_keys(TOKEN_APPS))) !== 0) {
        respond(400, ['error' => 'Invalid token access']);
    }
    $access = emptyTokenAccess();
    foreach (TOKEN_APPS as $app => $_) {
        $grant = $input[$app] ?? $access[$app];
        if (!is_array($grant) || count($grant) !== 2
            || !in_array($grant['all'] ?? null, ['none', 'read', 'edit'], true)
            || !is_array($grant['resources'] ?? null) || !array_is_list($grant['resources'])
            || count($grant['resources']) > API_TOKEN_MAX_RESOURCE_GRANTS
            || ($grant['all'] !== 'none' && $grant['resources'] !== [])) {
            respond(400, ['error' => "Invalid $app access"]);
        }
        $seen = [];
        foreach ($grant['resources'] as $resource) {
            if (!is_array($resource) || count($resource) !== 2
                || !is_int($resource['id'] ?? null) || $resource['id'] < 1
                || !in_array($resource['permission'] ?? null, ['read', 'edit'], true)
                || isset($seen[$resource['id']])) {
                respond(400, ['error' => "Invalid $app access"]);
            }
            $seen[$resource['id']] = true;
        }
        if ($seen !== []) {
            $owned = array_column(tokenAccessResources($app, $ownerId), null, 'id');
            foreach (array_keys($seen) as $id) {
                if (!isset($owned[$id])) respond(400, ['error' => "$app access includes a resource you do not own"]);
            }
        }
        $access[$app] = $grant;
    }
    return $access;
}

function scopesForTokenAccess(array $access): array
{
    $scopes = [];
    foreach (TOKEN_APPS as $app => $_) {
        $grant = $access[$app];
        if ($grant['all'] !== 'none' || $grant['resources'] !== []) $scopes[] = "$app:read";
        if ($grant['all'] === 'edit'
            || in_array('edit', array_column($grant['resources'], 'permission'), true)) {
            $scopes[] = "$app:write";
        }
    }
    return $scopes;
}

function tokenTimestamp(?string $value): ?string
{
    return $value === null ? null : (new DateTimeImmutable($value))->format(DATE_ATOM);
}

function requireTokenOwner(): array
{
    $user = currentSessionUser();
    if (($user['account_kind'] ?? 'human') !== 'human') {
        respond(403, ['error' => 'Browser session required']);
    }
    header('Cache-Control: private, no-store');
    return $user;
}

function publicApiToken(array $row): array
{
    return [
        'id' => (int) $row['id'],
        'name' => $row['name'],
        'user_id' => (int) $row['user_id'],
        'username' => $row['username'],
        'access' => json_decode($row['app_access'], true) ?: emptyTokenAccess(),
        'scopes' => json_decode($row['scopes'], true),
        'created' => tokenTimestamp($row['created']),
        'expires' => tokenTimestamp($row['expires']),
        'last_used_at' => tokenTimestamp($row['last_used_at']),
        'revoked_at' => tokenTimestamp($row['revoked_at']),
    ];
}

function handleListApiTokens(): never
{
    $owner = requireTokenOwner();
    $db = connectDb();
    $result = @pg_query_params($db,
        'SELECT t.id, t.name, t.user_id, u.display_name AS username,
                t.scopes, t.app_access,
                t.created, t.expires, t.last_used_at, t.revoked_at
         FROM public.api_token t JOIN public."user" u ON u.id = t.user_id
         WHERE t.created_by = $1
         ORDER BY CASE WHEN t.revoked_at IS NULL
             AND (t.expires IS NULL OR t.expires > CURRENT_TIMESTAMP) THEN 0 ELSE 1 END,
             t.id DESC LIMIT 100', [(int) $owner['id']]);
    if ($result === false) respond(500, ['error' => 'Failed to list API tokens']);
    $tokens = [];
    while (($row = pg_fetch_assoc($result)) !== false) $tokens[] = publicApiToken($row);
    respond(200, ['tokens' => $tokens]);
}

function handleCreateApiToken(): never
{
    $owner = requireTokenOwner();
    $payload = readJsonBody(262144);
    $name = $payload['name'] ?? null;
    $scopes = $payload['scopes'] ?? [];
    $days = $payload['expires_in_days'] ?? null;
    $access = $payload['access'] ?? emptyTokenAccess();
    if ($payload === null || !array_key_exists('expires_in_days', $payload)
        || !is_string($name) || trim($name) === '' || strlen(trim($name)) > 100
        || preg_match('//u', $name) !== 1
        || preg_match('/[\x00-\x1F\x7F]/u', $name) === 1
        || !is_array($scopes) || !array_is_list($scopes)
        || count($scopes) > count(tokenScopes())
        || count(array_filter($scopes, static fn ($scope) => is_string($scope)
            && in_array($scope, tokenScopes(), true))) !== count($scopes)
        || count(array_unique($scopes)) !== count($scopes)
        || ($days !== null && (!is_int($days) || $days < 1 || $days > 365))) {
        respond(400, ['error' => 'Invalid token name, scopes, or expiry']);
    }
    $db = connectDb();
    if (@pg_query($db, 'BEGIN') === false) respond(500, ['error' => 'Failed to create API token']);
    $target = @pg_query_params($db,
        'SELECT id FROM public."user" WHERE id = $1 AND account_kind = \'human\'
         AND verified = TRUE AND approved_at IS NOT NULL AND deleting = FALSE FOR UPDATE',
        [$owner['id']]);
    if ($target === false || pg_num_rows($target) === 0) {
        respond(403, ['error' => 'Account is not active']);
    }
    $limits = @pg_query_params($db,
        'SELECT COUNT(*) FILTER (WHERE revoked_at IS NULL
            AND (expires IS NULL OR expires > CURRENT_TIMESTAMP)) AS active,
            COUNT(*) FILTER (WHERE created > CURRENT_TIMESTAMP - INTERVAL \'1 day\') AS recent
         FROM public.api_token WHERE created_by = $1', [$owner['id']]);
    if ($limits === false) respond(500, ['error' => 'Failed to check token limit']);
    $counts = pg_fetch_assoc($limits);
    if ((int) $counts['active'] >= 100 || (int) $counts['recent'] >= 20) {
        respond(429, ['error' => 'API token limit reached']);
    }
    $access = validatedTokenAccess((int) $owner['id'], $access);
    $scopes = array_values(array_unique([...$scopes, ...scopesForTokenAccess($access)]));
    if ($scopes === []) respond(400, ['error' => 'Choose at least one token permission']);
    $service = @pg_query_params($db,
        'INSERT INTO public."user"
            (username, account_kind, service_owner_id, display_name, verified, approved_at)
         VALUES ($1, \'service\', $2, $3, TRUE, CURRENT_TIMESTAMP) RETURNING id',
        ['bot_' . bin2hex(random_bytes(16)), $owner['id'], trim($name)]);
    if ($service === false) respond(500, ['error' => 'Failed to create service account']);
    $serviceId = pg_fetch_result($service, 0, 0);
    $token = 'sat_' . rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
    $result = @pg_query_params($db,
        'INSERT INTO public.api_token (user_id, created_by, name, token_hash, scopes, expires, app_access)
         VALUES ($1, $2, $3, $4, $5::jsonb, CURRENT_TIMESTAMP + ($6::int * INTERVAL \'1 day\'),
            $7::jsonb)
         RETURNING id, created, expires',
        [$serviceId, $owner['id'], trim($name), hash('sha256', $token),
         json_encode($scopes, JSON_THROW_ON_ERROR), $days,
         json_encode($access, JSON_THROW_ON_ERROR)]);
    if ($result === false || @pg_query($db, 'COMMIT') === false) {
        respond(500, ['error' => 'Failed to create API token']);
    }
    $row = pg_fetch_assoc($result);
    respond(201, ['id' => (int) $row['id'], 'user_id' => (int) $serviceId, 'token' => $token,
        'expires' => tokenTimestamp($row['expires'])]);
}

function handleRevokeApiToken(int $tokenId): never
{
    $owner = requireTokenOwner();
    $db = connectDb();
    $result = @pg_query_params($db,
        'UPDATE public.api_token SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP)
         WHERE id = $1 AND created_by = $2 RETURNING id', [$tokenId, $owner['id']]);
    if ($result === false) {
        respond(500, ['error' => 'Failed to revoke API token']);
    }
    if (pg_num_rows($result) === 0) respond(404, ['error' => 'API token not found']);
    http_response_code(204);
    exit;
}

function handleTokenCapabilities(): never
{
    $owner = requireTokenOwner();
    $apps = [];
    foreach (TOKEN_APPS as $id => $definition) {
        $apps[] = ['id' => $id, 'name' => $definition['name'],
            'resource' => $definition['resource'],
            'read_scope' => "$id:read", 'write_scope' => "$id:write",
            'read_label' => $definition['read'], 'write_label' => $definition['write'],
            'resources' => tokenAccessResources($id, (int) $owner['id'])];
    }
    respond(200, ['apps' => $apps, 'extra_scopes' => [
        ['id' => 'media:read', 'label' => 'Read media'],
        ['id' => 'media:write', 'label' => 'Upload and edit media'],
    ]]);
}

function handleUpdateApiTokenAccess(int $tokenId): never
{
    $owner = requireTokenOwner();
    $payload = readJsonBody(262144);
    if ($payload === null || !array_key_exists('access', $payload)) {
        respond(400, ['error' => 'Token access is required']);
    }
    $db = connectDb();
    if (@pg_query($db, 'BEGIN') === false) respond(500, ['error' => 'Failed to update token access']);
    $result = @pg_query_params($db,
        'SELECT scopes, revoked_at, expires FROM public.api_token
         WHERE id = $1 AND created_by = $2 FOR UPDATE', [$tokenId, $owner['id']]);
    if ($result === false) respond(500, ['error' => 'Failed to update token access']);
    $token = pg_fetch_assoc($result);
    if ($token === false) respond(404, ['error' => 'API token not found']);
    if ($token['revoked_at'] !== null || ($token['expires'] !== null
        && new DateTimeImmutable($token['expires']) <= new DateTimeImmutable())) {
        respond(409, ['error' => 'Token is no longer active']);
    }
    $access = validatedTokenAccess((int) $owner['id'], $payload['access']);
    $scopes = array_values(array_unique([
        ...(json_decode($token['scopes'], true) ?: []), ...scopesForTokenAccess($access),
    ]));
    $updated = @pg_query_params($db,
        'UPDATE public.api_token SET app_access = $1::jsonb, scopes = $2::jsonb WHERE id = $3',
        [json_encode($access, JSON_THROW_ON_ERROR), json_encode($scopes, JSON_THROW_ON_ERROR), $tokenId]);
    if ($updated === false || @pg_query($db, 'COMMIT') === false) {
        respond(500, ['error' => 'Failed to update token access']);
    }
    respond(200, ['access' => $access, 'scopes' => $scopes]);
}

function handleApiTokenActivity(int $tokenId): never
{
    $owner = requireTokenOwner();
    $db = connectDb();
    $token = @pg_query_params($db,
        'SELECT id FROM public.api_token WHERE id = $1 AND created_by = $2',
        [$tokenId, $owner['id']]);
    if ($token === false) respond(500, ['error' => 'Failed to load token activity']);
    if (pg_num_rows($token) === 0) respond(404, ['error' => 'API token not found']);
    $result = @pg_query_params($db,
        'SELECT id, method, path, status, created FROM public.api_token_activity
         WHERE token_id = $1 ORDER BY id DESC LIMIT 100', [$tokenId]);
    if ($result === false) respond(500, ['error' => 'Failed to load token activity']);
    $activity = [];
    while (($row = pg_fetch_assoc($result)) !== false) {
        $activity[] = [
            'id' => (int) $row['id'], 'method' => $row['method'], 'path' => $row['path'],
            'status' => (int) $row['status'], 'created' => tokenTimestamp($row['created']),
        ];
    }
    respond(200, ['activity' => $activity]);
}
