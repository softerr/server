<?php
declare(strict_types=1);

// An installed app grants token scopes only when it includes a token definition.
function loadTokenApps(): array
{
    $definitions = [];
    foreach (glob(__DIR__ . '/../apps/*/token.php') ?: [] as $file) {
        $app = basename(dirname($file));
        $definition = require $file;
        if (!preg_match('/^[a-z][a-z0-9_]*$/D', $app) || !is_array($definition)
            || ($definition['database'] ?? null) !== $app
            || !is_string($definition['name'] ?? null)
            || !is_string($definition['resource'] ?? null)
            || !is_string($definition['read'] ?? null)
            || !is_string($definition['write'] ?? null)
            || !is_string($definition['resources_sql'] ?? null)
            || !is_string($definition['owner_sql'] ?? null)
            || !is_bool($definition['owner_image_upload'] ?? null)
            || (isset($definition['owner_image_reference_sql'])
                && !is_string($definition['owner_image_reference_sql']))) {
            throw new LogicException("Invalid token definition for {$app}");
        }
        $definitions[$app] = $definition;
    }
    return $definitions;
}

define('TOKEN_APPS', loadTokenApps());

function tokenScopes(): array
{
    $scopes = [];
    foreach (TOKEN_APPS as $app => $_) {
        $scopes[] = "$app:read";
        $scopes[] = "$app:write";
    }
    return [...$scopes, 'media:read', 'media:write'];
}

function emptyTokenAccess(): array
{
    $access = [];
    foreach (TOKEN_APPS as $app => $_) $access[$app] = ['all' => 'none', 'resources' => []];
    return $access;
}

function tokenAccessResources(string $app, int $ownerId): array
{
    $definition = TOKEN_APPS[$app] ?? throw new LogicException('Unknown token app');
    $result = @pg_query_params(connectAppDb($definition['database']), $definition['resources_sql'], [$ownerId]);
    if ($result === false) respond(500, ['error' => 'Failed to load token resources']);
    $items = [];
    while (($row = pg_fetch_assoc($result)) !== false) {
        $items[] = ['id' => (int) $row['id'], 'name' => $row['name']];
    }
    return $items;
}

function tokenResourceOwner(string $app, int $resourceId): ?int
{
    $definition = TOKEN_APPS[$app] ?? throw new LogicException('Unknown token app');
    $result = @pg_query_params(connectAppDb($definition['database']), $definition['owner_sql'], [$resourceId]);
    if ($result === false) respond(500, ['error' => 'Failed to check token resource']);
    $row = pg_fetch_assoc($result);
    return $row === false ? null : (int) $row['auth_user_id'];
}
