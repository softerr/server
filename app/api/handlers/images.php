<?php
declare(strict_types=1);

const MEDIA_IMAGE_MAX_BYTES = 2097152;
const MEDIA_PERSONAL_MAX_BYTES = 33554432;
const MEDIA_PERSONAL_MAX_COUNT = 256;
const QUIZ_IMPORT_MAX_BYTES = 50331648;
const QUIZ_IMPORT_MAX_IMAGES = 4096;
const QUIZ_IMAGE_REFERENCE_PATH = '$.** ? (@.image_id == $id || @.answer_image_id == $id || @.keyword_image_id == $id || @.definition_image_id == $id || @.name_image_id == $id)';
const QUIZ_VISIBLE_IMAGE_REFERENCE_PATH = '$.** ? (@.image_id == $id || @.keyword_image_id == $id || @.definition_image_id == $id || @.name_image_id == $id)';
const QUIZ_ANSWER_IMAGE_REFERENCE_PATH = '$.** ? (@.answer_image_id == $id)';

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

function verifyQuestionImages(int $authUserId, string $config): void
{
    $ids = imageIdsFromConfig(json_decode($config, true, 512, JSON_THROW_ON_ERROR));
    if (!$ids) return;
    $db = connectMediaDb();
    $result = @pg_query_params($db,
        'SELECT id FROM public.image
         WHERE (owner_auth_user_id = $1 OR shared = TRUE)
           AND id = ANY($2::bigint[])',
        [$authUserId, '{' . implode(',', $ids) . '}']);
    if ($result === false) respond(500, ['error' => 'Failed to check images']);
    if (pg_num_rows($result) !== count($ids)) {
        respond(400, ['error' => 'Choose images from your image library']);
    }
}

function validQuizImage(string $bytes): array
{
    if ($bytes === '' || strlen($bytes) > MEDIA_IMAGE_MAX_BYTES) {
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

function publicMediaImage(array $row): array
{
    return [
        'id' => (int) $row['id'],
        'name' => $row['original_name'],
        'mime_type' => $row['mime_type'],
        'width' => (int) $row['width'],
        'height' => (int) $row['height'],
        'size_bytes' => (int) $row['size_bytes'],
        'scope' => $row['shared'] === 't' ? 'shared' : 'personal',
        'group_id' => isset($row['group_id']) ? (int) $row['group_id'] : null,
    ];
}

function ensureMediaAccountActive(int $authUserId, bool $adminRequired = false): void
{
    $db = connectDb();
    $result = @pg_query_params($db,
        'SELECT role FROM public."user" WHERE id = $1 AND verified = TRUE
           AND approved_at IS NOT NULL AND deleting = FALSE', [$authUserId]);
    if ($result === false) respond(500, ['error' => 'Failed to authorize image action']);
    $account = pg_fetch_assoc($result);
    if ($account === false) respond(401, ['error' => 'Not authenticated']);
    if ($adminRequired && $account['role'] !== 'admin') {
        respond(403, ['error' => 'Admin access required']);
    }
}

function mediaImageByHash($db, int $authUserId, string $hash): ?array
{
    $result = @pg_query_params($db,
        'SELECT i.id, i.original_name, i.shared, i.group_id, b.mime_type, b.width, b.height,
                octet_length(b.content) AS size_bytes
         FROM public.image i JOIN public.image_blob b ON b.id = i.blob_id
         WHERE b.sha256 = $1 AND (i.shared = TRUE OR i.owner_auth_user_id = $2)
         ORDER BY i.shared DESC LIMIT 1',
        [$hash, $authUserId]);
    if ($result === false) respond(500, ['error' => 'Failed to save image']);
    $row = pg_fetch_assoc($result);
    return $row === false ? null : publicMediaImage($row);
}

function mediaBlobId($db, string $hash, string $bytes, string $mime, int $width, int $height): string
{
    $insert = @pg_query_params($db,
        'INSERT INTO public.image_blob (sha256, mime_type, width, height, content)
         VALUES ($1, $2, $3, $4, $5::bytea) ON CONFLICT (sha256) DO NOTHING',
        [$hash, $mime, $width, $height, '\\x' . bin2hex($bytes)]);
    $blob = $insert === false ? false : @pg_query_params($db,
        'SELECT id FROM public.image_blob WHERE sha256 = $1', [$hash]);
    $blobId = $blob === false ? false : pg_fetch_result($blob, 0, 'id');
    if ($blobId === false) respond(500, ['error' => 'Failed to save image']);
    return $blobId;
}

function saveMediaImage($db, int $authUserId, string $name, string $bytes,
    string $mime, int $width, int $height): array
{
    $hash = hash('sha256', $bytes);
    $existing = mediaImageByHash($db, $authUserId, $hash);
    if ($existing !== null) return $existing;

    $usage = @pg_query_params($db,
            'SELECT COUNT(*) AS total, COALESCE(SUM(octet_length(b.content)), 0) AS bytes
             FROM public.image i JOIN public.image_blob b ON b.id = i.blob_id
             WHERE i.owner_auth_user_id = $1', [$authUserId]);
    if ($usage === false) respond(500, ['error' => 'Failed to save image']);
    $used = pg_fetch_assoc($usage);
    if ((int) $used['total'] >= MEDIA_PERSONAL_MAX_COUNT
        || (int) $used['bytes'] + strlen($bytes) > MEDIA_PERSONAL_MAX_BYTES) {
        respond(409, ['error' => 'Image library is full (256 images or 32 MiB)']);
    }

    $blobId = mediaBlobId($db, $hash, $bytes, $mime, $width, $height);

    $insert = @pg_query_params($db,
        'INSERT INTO public.image (blob_id, owner_auth_user_id, uploaded_by_auth_user_id, shared, original_name)
         VALUES ($1, $2, $2, FALSE, $3) ON CONFLICT DO NOTHING',
        [$blobId, $authUserId, $name]);
    if ($insert === false) respond(500, ['error' => 'Failed to save image']);
    $stored = @pg_query_params($db,
        'SELECT i.id, i.original_name, i.shared, i.group_id, b.mime_type, b.width, b.height,
                octet_length(b.content) AS size_bytes
         FROM public.image i JOIN public.image_blob b ON b.id = i.blob_id
         WHERE i.blob_id = $1 AND i.owner_auth_user_id = $2
         LIMIT 1', [$blobId, $authUserId]);
    $row = $stored === false ? false : pg_fetch_assoc($stored);
    if ($row === false) respond(500, ['error' => 'Failed to save image']);
    return publicMediaImage($row);
}

function listMediaImages(bool $mineOnly): never
{
    $user = currentSessionUser();
    $db = connectMediaDb();
    $result = @pg_query_params($db,
        'SELECT i.id, i.original_name, i.shared, i.group_id, b.mime_type, b.width, b.height,
                octet_length(b.content) AS size_bytes
         FROM public.image i JOIN public.image_blob b ON b.id = i.blob_id
         WHERE i.owner_auth_user_id = $1 OR (NOT $2::boolean AND i.shared = TRUE)
         ORDER BY i.shared DESC, lower(i.original_name), i.original_name, i.id',
        [$user['id'], $mineOnly ? 'true' : 'false']);
    if ($result === false) respond(500, ['error' => 'Failed to load images']);
    $images = [];
    $usedBytes = 0;
    $personalCount = 0;
    while ($row = pg_fetch_assoc($result)) {
        $images[] = publicMediaImage($row);
        if ($row['shared'] !== 't') {
            $personalCount++;
            $usedBytes += (int) $row['size_bytes'];
        }
    }
    respond(200, [
        'images' => $images,
        'usage' => ['count' => $personalCount, 'bytes' => $usedBytes],
        'limits' => [
            'count' => MEDIA_PERSONAL_MAX_COUNT,
            'bytes' => MEDIA_PERSONAL_MAX_BYTES,
            'per_image_bytes' => MEDIA_IMAGE_MAX_BYTES,
        ],
    ]);
}

function handleListImages(): never
{
    listMediaImages(false);
}

function handleListMyImages(): never
{
    listMediaImages(true);
}

function readMediaUpload(): array
{
    $rawName = $_SERVER['HTTP_X_IMAGE_NAME'] ?? '';
    if (!is_string($rawName) || preg_match('/%(?![0-9A-Fa-f]{2})/', $rawName)) {
        respond(400, ['error' => 'X-Image-Name must be a URL-encoded filename']);
    }
    $name = validQuizImageName(rawurldecode($rawName));
    $bytes = file_get_contents('php://input', false, null, 0, MEDIA_IMAGE_MAX_BYTES + 1);
    if ($bytes === false) respond(400, ['error' => 'Could not read image']);
    [$mime, $width, $height] = validQuizImage($bytes);
    return [$name, $bytes, $mime, $width, $height];
}

function handleUploadImage(): never
{
    $user = currentSessionUser();
    [$name, $bytes, $mime, $width, $height] = readMediaUpload();
    $db = connectMediaDb();
    if (@pg_query($db, 'BEGIN') === false) respond(500, ['error' => 'Failed to save image']);
    $lock = @pg_query_params($db, 'SELECT pg_advisory_xact_lock($1)', [$user['id']]);
    if ($lock === false) respond(500, ['error' => 'Failed to save image']);
    ensureMediaAccountActive((int) $user['id']);
    $image = saveMediaImage($db, (int) $user['id'], $name, $bytes, $mime, $width, $height);
    if (@pg_query($db, 'COMMIT') === false) respond(500, ['error' => 'Failed to save image']);
    respond(201, $image);
}

function handleUploadSharedImage(?int $groupId = null): never
{
    $user = currentSessionUser();
    if ($user['role'] !== 'admin') respond(403, ['error' => 'Admin access required']);
    [$name, $bytes, $mime, $width, $height] = readMediaUpload();
    $db = connectMediaDb();
    if (@pg_query($db, 'BEGIN') === false) respond(500, ['error' => 'Failed to save image']);
    ensureMediaAccountActive((int) $user['id'], true);
    if ($groupId !== null) {
        $group = @pg_query_params($db,
            'SELECT id FROM public.media_group WHERE id = $1 FOR KEY SHARE', [$groupId]);
        if ($group === false) respond(500, ['error' => 'Failed to check folder']);
        if (pg_num_rows($group) === 0) respond(404, ['error' => 'Folder not found']);
    }

    $hash = hash('sha256', $bytes);
    $blobId = mediaBlobId($db, $hash, $bytes, $mime, $width, $height);

    $insert = @pg_query_params($db,
        'INSERT INTO public.image (blob_id, uploaded_by_auth_user_id, group_id, shared, original_name)
         VALUES ($1, $2, $3, TRUE, $4) ON CONFLICT DO NOTHING RETURNING id',
        [$blobId, $user['id'], $groupId, $name]);
    if ($insert === false) respond(500, ['error' => 'Failed to save image']);
    $created = pg_num_rows($insert) > 0;
    $stored = @pg_query_params($db,
        'SELECT i.id, i.original_name, i.shared, i.group_id, b.mime_type, b.width, b.height,
                octet_length(b.content) AS size_bytes
         FROM public.image i JOIN public.image_blob b ON b.id = i.blob_id
         WHERE i.blob_id = $1 AND i.shared = TRUE', [$blobId]);
    $row = $stored === false ? false : pg_fetch_assoc($stored);
    if ($row === false) respond(500, ['error' => 'Failed to save image']);
    if (($row['group_id'] === null ? null : (int) $row['group_id']) !== $groupId) {
        respond(409, ['error' => 'This image is already shared in another folder']);
    }
    if (@pg_query($db, 'COMMIT') === false) respond(500, ['error' => 'Failed to save image']);
    respond($created ? 201 : 200, publicMediaImage($row));
}

function handlePublishImage(int $imageId): never
{
    $user = currentSessionUser();
    if ($user['role'] !== 'admin') respond(403, ['error' => 'Admin access required']);
    $db = connectMediaDb();
    if (@pg_query($db, 'BEGIN') === false
        || @pg_query_params($db, 'SELECT pg_advisory_xact_lock($1)', [$user['id']]) === false) {
        respond(500, ['error' => 'Failed to publish image']);
    }
    ensureMediaAccountActive((int) $user['id'], true);
    $image = @pg_query_params($db,
        'SELECT i.id, i.blob_id, i.original_name, i.shared, i.group_id, b.mime_type, b.width, b.height,
                octet_length(b.content) AS size_bytes
         FROM public.image i JOIN public.image_blob b ON b.id = i.blob_id
         WHERE i.id = $1 AND i.owner_auth_user_id = $2 AND i.shared = FALSE
         FOR UPDATE OF i', [$imageId, $user['id']]);
    if ($image === false) respond(500, ['error' => 'Failed to publish image']);
    $row = pg_fetch_assoc($image);
    if ($row === false) respond(404, ['error' => 'Image not found']);
    $existing = @pg_query_params($db,
        'SELECT 1 FROM public.image WHERE blob_id = $1 AND shared = TRUE LIMIT 1', [$row['blob_id']]);
    if ($existing === false) respond(500, ['error' => 'Failed to publish image']);
    if (pg_num_rows($existing) > 0) respond(409, ['error' => 'This image is already shared']);
    $published = @pg_query_params($db,
        'UPDATE public.image SET owner_auth_user_id = NULL, shared = TRUE
         WHERE id = $1 AND owner_auth_user_id = $2 RETURNING id', [$imageId, $user['id']]);
    if ($published === false) respond(409, ['error' => 'This image is already shared']);
    if (@pg_query($db, 'COMMIT') === false) respond(500, ['error' => 'Failed to publish image']);
    $row['shared'] = 't';
    respond(200, publicMediaImage($row));
}

function imageUsedByAccessibleQuiz(int $imageId, int $authUserId): bool
{
    $quizDb = connectQuizDb();
    $result = @pg_query_params($quizDb,
        'SELECT EXISTS (
            SELECT 1 FROM public.quiz_attempt_question s
            JOIN public.quiz_attempt a ON a.id = s.attempt_id
            JOIN public.quiz_attempt_source b ON b.attempt_id = s.attempt_id AND b.question_id = s.source_question_id
            JOIN public."user" u ON u.id = a.user_id
            JOIN public.quiz q ON q.id = a.quiz_id
            LEFT JOIN public.quiz_answer r ON r.attempt_id = s.attempt_id AND r.question_id = s.id
            WHERE u.auth_user_id = $4 AND (a.completed IS NOT NULL OR s.position <= GREATEST(1, a.furthest_position))
              AND (jsonb_path_exists(b.config, $1::jsonpath, jsonb_build_object(\'id\', $3::bigint))
                OR ((a.completed IS NOT NULL AND q.show_correct_answers = TRUE
                    OR b.template = \'show_answer\' AND r.answer->>\'revealed\' = \'true\')
                  AND jsonb_path_exists(b.config, $2::jsonpath, jsonb_build_object(\'id\', $3::bigint))))
         ) AS visible',
        [QUIZ_VISIBLE_IMAGE_REFERENCE_PATH, QUIZ_ANSWER_IMAGE_REFERENCE_PATH, $imageId, $authUserId]);
    if ($result === false) respond(500, ['error' => 'Failed to check quiz image']);
    return pg_fetch_result($result, 0, 'visible') === 't';
}

function handleGetImage(int $imageId): never
{
    $user = currentSessionUser();
    $db = connectMediaDb();
    $result = @pg_query_params($db,
        'SELECT i.original_name, b.mime_type, b.content
         FROM public.image i JOIN public.image_blob b ON b.id = i.blob_id
         WHERE i.id = $1 AND (i.owner_auth_user_id = $2 OR i.shared = TRUE)',
        [$imageId, $user['id']]);
    if ($result === false) respond(500, ['error' => 'Failed to load image']);
    $row = pg_fetch_assoc($result);
    if ($row === false) {
        if (!imageUsedByAccessibleQuiz($imageId, (int) $user['id'])) {
            respond(404, ['error' => 'Image not found']);
        }
        $result = @pg_query_params($db,
            'SELECT i.original_name, b.mime_type, b.content
             FROM public.image i JOIN public.image_blob b ON b.id = i.blob_id WHERE i.id = $1',
            [$imageId]);
        if ($result === false) respond(500, ['error' => 'Failed to load image']);
        $row = pg_fetch_assoc($result);
        if ($row === false) respond(404, ['error' => 'Image not found']);
    }
    header('Content-Type: ' . $row['mime_type']);
    header("Content-Disposition: inline; filename*=UTF-8''" . rawurlencode($row['original_name']));
    header('X-Content-Type-Options: nosniff');
    header('Cache-Control: private, no-store');
    echo pg_unescape_bytea($row['content']);
    exit;
}

function handleRenameImage(int $imageId): never
{
    $user = currentSessionUser();
    $payload = readJsonBody();
    if (!is_array($payload) || !is_string($payload['name'] ?? null)) {
        respond(400, ['error' => 'Image name is required']);
    }
    $name = validQuizImageName($payload['name']);
    $db = connectMediaDb();
    $result = @pg_query_params($db,
        'WITH renamed AS (
           UPDATE public.image SET original_name = $1
           WHERE id = $2 AND (owner_auth_user_id = $3 OR (shared = TRUE AND $4::boolean))
           RETURNING id, blob_id, original_name, shared, group_id
         )
         SELECT i.id, i.original_name, i.shared, i.group_id, b.mime_type, b.width, b.height,
                octet_length(b.content) AS size_bytes
         FROM renamed i JOIN public.image_blob b ON b.id = i.blob_id',
        [$name, $imageId, $user['id'], $user['role'] === 'admin' ? 'true' : 'false']);
    if ($result === false) respond(500, ['error' => 'Failed to rename image']);
    $row = pg_fetch_assoc($result);
    if ($row === false) respond(404, ['error' => 'Image not found']);
    respond(200, publicMediaImage($row));
}

function handleDeleteImage(int $imageId): never
{
    $user = currentSessionUser();
    // A quiz write takes this lock before checking image access. It prevents a
    // quiz from acquiring a reference between this check and the deletion.
    $quizDb = connectQuizDb();
    if (@pg_query($quizDb, 'BEGIN') === false
        || @pg_query_params($quizDb, 'SELECT pg_advisory_xact_lock($1)', [$user['id']]) === false) {
        respond(500, ['error' => 'Failed to delete image']);
    }
    $used = @pg_query_params($quizDb,
        'SELECT EXISTS (
            SELECT 1 FROM public.question t JOIN public.quiz q ON q.id = t.quiz_id
            JOIN public."user" u ON u.id = q.user_id
            WHERE u.auth_user_id = $1 AND jsonb_path_exists(t.config, $2::jsonpath,
              jsonb_build_object(\'id\', $3::bigint))
         ) OR EXISTS (
            SELECT 1 FROM public.quiz_attempt_source s
            JOIN public.quiz_attempt a ON a.id = s.attempt_id
            JOIN public.quiz q ON q.id = a.quiz_id
            JOIN public."user" u ON u.id = q.user_id
            WHERE u.auth_user_id = $1 AND jsonb_path_exists(s.config, $2::jsonpath,
              jsonb_build_object(\'id\', $3::bigint))
         ) AS used',
        [$user['id'],
         QUIZ_IMAGE_REFERENCE_PATH,
         $imageId]);
    if ($used === false) respond(500, ['error' => 'Failed to delete image']);
    if (pg_fetch_result($used, 0, 'used') === 't') {
        respond(409, ['error' => 'Image is used by a quiz or saved attempt']);
    }

    $db = connectMediaDb();
    if (@pg_query($db, 'BEGIN') === false) respond(500, ['error' => 'Failed to delete image']);
    $deleted = @pg_query_params($db,
        'DELETE FROM public.image WHERE id = $1 AND owner_auth_user_id = $2
         RETURNING blob_id', [$imageId, $user['id']]);
    if ($deleted === false) respond(500, ['error' => 'Failed to delete image']);
    $imageRow = pg_fetch_assoc($deleted);
    if ($imageRow === false) respond(404, ['error' => 'Image not found']);
    if (@pg_query_params($db,
            'DELETE FROM public.image_blob b WHERE b.id = $1
             AND NOT EXISTS (SELECT 1 FROM public.image i WHERE i.blob_id = b.id)',
            [$imageRow['blob_id']]) === false
        || @pg_query($db, 'COMMIT') === false
        || @pg_query($quizDb, 'COMMIT') === false) {
        respond(500, ['error' => 'Failed to delete image']);
    }
    header_remove('Content-Type');
    http_response_code(204);
    exit;
}
