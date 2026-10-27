<?php
declare(strict_types=1);

const QUIZ_IMAGE_MAX_BYTES = 2097152;
const QUIZ_IMAGE_TOTAL_BYTES = 33554432;
const QUIZ_IMAGE_MAX_COUNT = 256;
const QUIZ_IMPORT_MAX_BYTES = 50331648;

function quizImageOwner($db, int $authUserId): ?string
{
    $result = @pg_query_params($db,
        'SELECT id FROM public."user" WHERE auth_user_id = $1', [$authUserId]);
    if ($result === false) respond(500, ['error' => 'Failed to load images']);
    $row = pg_fetch_assoc($result);
    return $row === false ? null : $row['id'];
}

function imageIdsFromConfig(array $config): array
{
    $ids = [];
    foreach ($config as $key => $value) {
        if (is_string($key) && ($key === 'image_id' || str_ends_with($key, '_image_id'))) {
            $ids[] = $value;
        } elseif (is_array($value)) {
            array_push($ids, ...imageIdsFromConfig($value));
        }
    }
    return array_values(array_unique($ids));
}

function verifyQuestionImages($db, int $authUserId, string $config): void
{
    $ids = imageIdsFromConfig(json_decode($config, true, 512, JSON_THROW_ON_ERROR));
    if (!$ids) return;
    $result = @pg_query_params($db,
        'SELECT id FROM public.image WHERE user_id =
         (SELECT id FROM public."user" WHERE auth_user_id = $1)
         AND id = ANY($2::bigint[])',
        [$authUserId, '{' . implode(',', $ids) . '}']);
    if ($result === false) respond(500, ['error' => 'Failed to check images']);
    if (pg_num_rows($result) !== count($ids)) {
        respond(400, ['error' => 'Choose images from your image library']);
    }
}

function validQuizImage(string $bytes): array
{
    if ($bytes === '' || strlen($bytes) > QUIZ_IMAGE_MAX_BYTES) {
        respond(413, ['error' => 'Image must be at most 2 MiB']);
    }
    $info = @getimagesizefromstring($bytes);
    $mime = $info['mime'] ?? null;
    if (!in_array($mime, ['image/png', 'image/jpeg', 'image/webp'], true)
        || ($info[0] ?? 0) < 1 || ($info[0] ?? 0) > 4096
        || ($info[1] ?? 0) < 1 || ($info[1] ?? 0) > 4096) {
        respond(400, ['error' => 'Choose a PNG, JPEG, or WebP image up to 4096 pixels per side']);
    }
    return [$mime, $info[0], $info[1]];
}

function validQuizImageName(string $name): string
{
    if ($name === '' || strlen($name) > 255 || trim($name) === ''
        || preg_match('//u', $name) !== 1
        || preg_match('~[\x00-\x1F\x7F/\\\\]~u', $name) === 1
        || $name === '.' || $name === '..') {
        respond(400, ['error' => 'Image name must be a valid filename of at most 255 bytes']);
    }
    return $name;
}

function saveQuizImage($db, string $ownerId, string $name, string $bytes, string $mime, int $width, int $height): array
{
    $hash = hash('sha256', $bytes);
    $existing = @pg_query_params($db,
        'SELECT id, original_name, mime_type, width, height FROM public.image WHERE user_id = $1 AND sha256 = $2',
        [$ownerId, $hash]);
    if ($existing === false) respond(500, ['error' => 'Failed to save image']);
    $row = pg_fetch_assoc($existing);
    if ($row !== false) return publicQuizImage($row);
    $usage = @pg_query_params($db,
        'SELECT COUNT(*) AS total, COALESCE(SUM(octet_length(content)), 0) AS bytes
         FROM public.image WHERE user_id = $1', [$ownerId]);
    if ($usage === false) respond(500, ['error' => 'Failed to save image']);
    $used = pg_fetch_assoc($usage);
    if ((int) $used['total'] >= QUIZ_IMAGE_MAX_COUNT
        || (int) $used['bytes'] + strlen($bytes) > QUIZ_IMAGE_TOTAL_BYTES) {
        respond(409, ['error' => 'Image library is full (256 images or 32 MiB)']);
    }
    $result = @pg_query_params($db,
        'INSERT INTO public.image (user_id, sha256, original_name, mime_type, width, height, content)
         VALUES ($1, $2, $3, $4, $5, $6, $7::bytea)
         RETURNING id, original_name, mime_type, width, height',
        [$ownerId, $hash, $name, $mime, $width, $height, '\\x' . bin2hex($bytes)]);
    if ($result === false) respond(500, ['error' => 'Failed to save image']);
    return publicQuizImage(pg_fetch_assoc($result));
}

function publicQuizImage(array $row): array
{
    return [
        'id' => (int) $row['id'],
        'name' => $row['original_name'],
        'mime_type' => $row['mime_type'],
        'width' => (int) $row['width'],
        'height' => (int) $row['height'],
    ];
}

function handleListImages(): never
{
    $user = currentSessionUser();
    $db = connectQuizDb();
    $result = @pg_query_params($db,
        'SELECT i.id, i.original_name, i.mime_type, i.width, i.height,
            octet_length(i.content) AS size_bytes FROM public.image i
         JOIN public."user" u ON u.id = i.user_id WHERE u.auth_user_id = $1
         ORDER BY lower(i.original_name), i.original_name, i.id',
        [$user['id']]);
    if ($result === false) respond(500, ['error' => 'Failed to load images']);
    $images = [];
    $usedBytes = 0;
    while ($row = pg_fetch_assoc($result)) {
        $images[] = publicQuizImage($row);
        $usedBytes += (int) $row['size_bytes'];
    }
    respond(200, [
        'images' => $images,
        'usage' => ['count' => count($images), 'bytes' => $usedBytes],
        'limits' => [
            'count' => QUIZ_IMAGE_MAX_COUNT,
            'bytes' => QUIZ_IMAGE_TOTAL_BYTES,
            'per_image_bytes' => QUIZ_IMAGE_MAX_BYTES,
        ],
    ]);
}

function handleUploadImage(): never
{
    $user = currentSessionUser();
    $rawName = $_SERVER['HTTP_X_IMAGE_NAME'] ?? '';
    if (!is_string($rawName) || preg_match('/%(?![0-9A-Fa-f]{2})/', $rawName)) {
        respond(400, ['error' => 'X-Image-Name must be a URL-encoded filename']);
    }
    $name = validQuizImageName(rawurldecode($rawName));
    $bytes = file_get_contents('php://input', false, null, 0, QUIZ_IMAGE_MAX_BYTES + 1);
    if ($bytes === false) respond(400, ['error' => 'Could not read image']);
    [$mime, $width, $height] = validQuizImage($bytes);
    $db = connectQuizDb();
    if (@pg_query($db, 'BEGIN') === false) respond(500, ['error' => 'Failed to save image']);
    if (@pg_query_params($db, 'SELECT pg_advisory_xact_lock($1)', [$user['id']]) === false) {
        respond(500, ['error' => 'Failed to save image']);
    }
    $ownerId = quizImageOwner($db, (int) $user['id']);
    if ($ownerId === null) respond(409, ['error' => 'Create a quiz before adding images']);
    $image = saveQuizImage($db, $ownerId, $name, $bytes, $mime, $width, $height);
    if (@pg_query($db, 'COMMIT') === false) respond(500, ['error' => 'Failed to save image']);
    respond(201, $image);
}

function handleGetImage(int $imageId): never
{
    $user = currentSessionUser();
    $db = connectQuizDb();
    $result = @pg_query_params($db,
        'SELECT i.original_name, i.mime_type, i.content FROM public.image i
         JOIN public."user" u ON u.id = i.user_id
         WHERE i.id = $1 AND u.auth_user_id = $2', [$imageId, $user['id']]);
    if ($result === false) respond(500, ['error' => 'Failed to load image']);
    $row = pg_fetch_assoc($result);
    if ($row === false) respond(404, ['error' => 'Image not found']);
    header('Content-Type: ' . $row['mime_type']);
    header("Content-Disposition: inline; filename*=UTF-8''" . rawurlencode($row['original_name']));
    header('X-Content-Type-Options: nosniff');
    header('Cache-Control: private, no-store');
    echo pg_unescape_bytea($row['content']);
    exit;
}

function handleDeleteImage(int $imageId): never
{
    $user = currentSessionUser();
    $db = connectQuizDb();
    if (@pg_query($db, 'BEGIN') === false) respond(500, ['error' => 'Failed to delete image']);
    if (@pg_query_params($db, 'SELECT pg_advisory_xact_lock($1)', [$user['id']]) === false) {
        respond(500, ['error' => 'Failed to delete image']);
    }
    $ownerId = quizImageOwner($db, (int) $user['id']);
    $image = @pg_query_params($db,
        'SELECT id FROM public.image WHERE id = $1 AND user_id = $2',
        [$imageId, $ownerId]);
    if ($image === false) respond(500, ['error' => 'Failed to delete image']);
    if (pg_num_rows($image) === 0) respond(404, ['error' => 'Image not found']);
    $used = @pg_query_params($db,
        'SELECT 1 FROM public.question t JOIN public.quiz q ON q.id = t.quiz_id
         WHERE q.user_id = $1 AND jsonb_path_exists(t.config, $2::jsonpath,
           jsonb_build_object(\'id\', $3::bigint)) LIMIT 1',
        [$ownerId,
         '$.** ? (@.image_id == $id || @.answer_image_id == $id || @.keyword_image_id == $id || @.definition_image_id == $id || @.name_image_id == $id)',
         $imageId]);
    if ($used === false) respond(500, ['error' => 'Failed to delete image']);
    if (pg_num_rows($used) > 0) respond(409, ['error' => 'Remove this image from questions before deleting it']);
    if (@pg_query_params($db, 'DELETE FROM public.image WHERE id = $1', [$imageId]) === false
        || @pg_query($db, 'COMMIT') === false) {
        respond(500, ['error' => 'Failed to delete image']);
    }
    header_remove('Content-Type');
    http_response_code(204);
    exit;
}
