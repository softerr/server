<?php
declare(strict_types=1);

function mediaAdmin(): array
{
    $user = currentSessionUser();
    if ($user['role'] !== 'admin') respond(403, ['error' => 'Admin access required']);
    ensureMediaAccountActive((int) $user['id'], true);
    return $user;
}

function mediaGroupName(?array $payload): string
{
    $name = $payload['name'] ?? null;
    if (!is_string($name)) respond(400, ['error' => 'Group name is required']);
    $name = trim($name);
    if ($name === '' || strlen($name) > 100 || preg_match('//u', $name) !== 1
        || preg_match('/[\x00-\x1F\x7F]/u', $name) === 1) {
        respond(400, ['error' => 'Group name must be 1 to 100 UTF-8 bytes without control characters']);
    }
    return $name;
}

function handleListMediaGroups(): never
{
    currentSessionUser();
    $db = connectMediaDb();
    $result = @pg_query($db,
        'SELECT g.id, g.name, COUNT(i.id) AS image_count,
                (SELECT cover.id FROM public.image cover
                 WHERE cover.group_id = g.id AND cover.shared = TRUE
                 ORDER BY cover.id DESC LIMIT 1) AS cover_image_id
         FROM public.media_group g LEFT JOIN public.image i ON i.group_id = g.id AND i.shared = TRUE
         GROUP BY g.id ORDER BY lower(g.name), g.name, g.id');
    if ($result === false) respond(500, ['error' => 'Failed to load media groups']);
    $groups = [];
    while ($row = pg_fetch_assoc($result)) {
        $groups[] = [
            'id' => (int) $row['id'],
            'name' => $row['name'],
            'image_count' => (int) $row['image_count'],
            'cover_image_id' => $row['cover_image_id'] === null ? null : (int) $row['cover_image_id'],
        ];
    }
    respond(200, ['groups' => $groups]);
}

function handleCreateMediaGroup(): never
{
    mediaAdmin();
    $name = mediaGroupName(readJsonBody());
    $db = connectMediaDb();
    $result = @pg_query_params($db,
        'INSERT INTO public.media_group (name) VALUES ($1)
         ON CONFLICT DO NOTHING RETURNING id, name', [$name]);
    if ($result === false) respond(500, ['error' => 'Failed to create media group']);
    $row = pg_fetch_assoc($result);
    if ($row === false) respond(409, ['error' => 'A group with this name already exists']);
    respond(201, ['id' => (int) $row['id'], 'name' => $row['name'],
        'image_count' => 0, 'cover_image_id' => null]);
}

function handleRenameMediaGroup(int $groupId): never
{
    mediaAdmin();
    $name = mediaGroupName(readJsonBody());
    $db = connectMediaDb();
    $result = @pg_query_params($db,
        'UPDATE public.media_group SET name = $1 WHERE id = $2 RETURNING id, name',
        [$name, $groupId]);
    if ($result === false) respond(409, ['error' => 'A group with this name already exists']);
    $row = pg_fetch_assoc($result);
    if ($row === false) respond(404, ['error' => 'Media group not found']);
    respond(200, ['id' => (int) $row['id'], 'name' => $row['name']]);
}

function handleDeleteMediaGroup(int $groupId): never
{
    mediaAdmin();
    $db = connectMediaDb();
    $result = @pg_query_params($db,
        'DELETE FROM public.media_group WHERE id = $1 RETURNING id', [$groupId]);
    if ($result === false) respond(500, ['error' => 'Failed to delete media group']);
    if (pg_num_rows($result) === 0) respond(404, ['error' => 'Media group not found']);
    header_remove('Content-Type');
    http_response_code(204);
    exit;
}

function handleListSharedImages(): never
{
    currentSessionUser();
    $db = connectMediaDb();
    $result = @pg_query($db,
        'SELECT i.id, i.original_name, i.shared, i.group_id, b.mime_type, b.width, b.height,
                octet_length(b.content) AS size_bytes
         FROM public.image i JOIN public.image_blob b ON b.id = i.blob_id
         WHERE i.shared = TRUE
         ORDER BY lower(i.original_name), i.original_name, i.id');
    if ($result === false) respond(500, ['error' => 'Failed to load shared images']);
    $images = [];
    while ($row = pg_fetch_assoc($result)) $images[] = publicMediaImage($row);
    respond(200, ['images' => $images]);
}

function handleMoveSharedImage(int $imageId): never
{
    mediaAdmin();
    $payload = readJsonBody();
    if (!is_array($payload) || !array_key_exists('group_id', $payload)
        || ($payload['group_id'] !== null
            && (!is_int($payload['group_id']) || $payload['group_id'] < 1))) {
        respond(400, ['error' => 'group_id must be a positive integer or null']);
    }
    $groupId = $payload['group_id'];
    $db = connectMediaDb();
    if ($groupId !== null) {
        $group = @pg_query_params($db, 'SELECT id FROM public.media_group WHERE id = $1', [$groupId]);
        if ($group === false) respond(500, ['error' => 'Failed to move image']);
        if (pg_num_rows($group) === 0) respond(404, ['error' => 'Media group not found']);
    }
    $result = @pg_query_params($db,
        'UPDATE public.image SET group_id = $1 WHERE id = $2 AND shared = TRUE
         RETURNING id, group_id', [$groupId, $imageId]);
    if ($result === false) respond(409, ['error' => 'Could not move image; the group may have changed']);
    $row = pg_fetch_assoc($result);
    if ($row === false) respond(404, ['error' => 'Shared image not found']);
    respond(200, ['id' => (int) $row['id'],
        'group_id' => $row['group_id'] === null ? null : (int) $row['group_id']]);
}
