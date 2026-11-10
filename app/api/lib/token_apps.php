<?php
declare(strict_types=1);

// This is the allowlist for API-token access. Deployment registration alone never grants access.
const TOKEN_APPS = [
    'quiz' => [
        'name' => 'Quiz', 'resource' => 'quizzes', 'read' => 'Read quizzes',
        'write' => 'Edit quizzes and attempts', 'database' => 'connectQuizDb',
        'resources_sql' => 'SELECT q.id, q.name FROM public.quiz q JOIN public."user" u ON u.id = q.user_id WHERE u.auth_user_id = $1 ORDER BY q.id DESC',
        'owner_sql' => 'SELECT u.auth_user_id FROM public.quiz q JOIN public."user" u ON u.id = q.user_id WHERE q.id = $1',
        'owner_image_upload' => false,
    ],
    'musico' => [
        'name' => 'Musico', 'resource' => 'playlists', 'read' => 'Read Musico',
        'write' => 'Edit Musico', 'database' => 'connectMusicoDb',
        'resources_sql' => 'SELECT p.id, p.name FROM public.playlist p JOIN public."user" u ON u.id = p.user_id WHERE u.auth_user_id = $1 ORDER BY p.id DESC',
        'owner_sql' => 'SELECT u.auth_user_id FROM public.playlist p JOIN public."user" u ON u.id = p.user_id WHERE p.id = $1',
        'owner_image_upload' => true,
    ],
    'mdb' => [
        'name' => 'MDB', 'resource' => 'databases', 'read' => 'Read MDB',
        'write' => 'Edit MDB', 'database' => 'connectMdbDb',
        'resources_sql' => 'SELECT d.id, d.name FROM public.user_database d JOIN public."user" u ON u.id = d.user_id WHERE u.auth_user_id = $1 ORDER BY d.id DESC',
        'owner_sql' => 'SELECT u.auth_user_id FROM public.user_database d JOIN public."user" u ON u.id = d.user_id WHERE d.id = $1',
        'owner_image_upload' => true,
    ],
];

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
    $connect = $definition['database'];
    $result = @pg_query_params($connect(), $definition['resources_sql'], [$ownerId]);
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
    $connect = $definition['database'];
    $result = @pg_query_params($connect(), $definition['owner_sql'], [$resourceId]);
    if ($result === false) respond(500, ['error' => 'Failed to check token resource']);
    $row = pg_fetch_assoc($result);
    return $row === false ? null : (int) $row['auth_user_id'];
}
