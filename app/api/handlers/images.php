<?php
declare(strict_types=1);

const MEDIA_IMAGE_MAX_BYTES = 6291456;
const MEDIA_PERSONAL_MAX_BYTES = 67108864;
const MEDIA_PERSONAL_MAX_COUNT = 1024;
const MEDIA_THUMBNAIL_MAX_SIDE = 320;
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

function verifyQuestionImages($quizDb, array $user, string $config): void
{
    $ids = imageIdsFromConfig(json_decode($config, true, 512, JSON_THROW_ON_ERROR));
    if (!$ids) return;
    sort($ids, SORT_NUMERIC);
    foreach ($ids as $id) {
        if (@pg_query_params($quizDb, 'SELECT pg_advisory_xact_lock($1::bigint)', [-$id]) === false) {
            respond(500, ['error' => 'Failed to check images']);
        }
    }
    $db = connectMediaDb();
    $result = @pg_query_params($db,
        'SELECT id, owner_auth_user_id, shared FROM public.image
         WHERE id = ANY($1::bigint[])',
        ['{' . implode(',', $ids) . '}']);
    if ($result === false) respond(500, ['error' => 'Failed to check images']);
    if (pg_num_rows($result) !== count($ids)) {
        respond(400, ['error' => 'Choose images from your image library']);
    }
    while (($row = pg_fetch_assoc($result)) !== false) {
        if ($row['shared'] === 't' || (int) $row['owner_auth_user_id'] === (int) $user['id']) continue;
        if (($user['service_owner_id'] ?? null) === null
            || (int) $row['owner_auth_user_id'] !== (int) $user['service_owner_id']
            || !imageUsedByReadableOwnerQuiz((int) $row['id'], $user)) {
            respond(400, ['error' => 'Choose images from your image library']);
        }
    }
}

function validQuizImage(string $bytes): array
{
    if ($bytes === '' || strlen($bytes) > MEDIA_IMAGE_MAX_BYTES) {
        respond(413, ['error' => 'Image must be at most 6 MiB']);
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
        'source' => isset($row['source_page']) ? [
            'page' => $row['source_page'],
            'creator' => $row['creator'],
            'license' => $row['license_name'],
            'license_url' => $row['license_url'],
            'attribution' => $row['attribution'],
        ] : null,
    ];
}

function validatedMediaSource(mixed $source): ?array
{
    if ($source === null) return null;
    if (!is_array($source)) respond(400, ['error' => 'Invalid image source']);
    foreach (['page', 'creator', 'license', 'attribution'] as $key) {
        if (!is_string($source[$key] ?? null) || strlen($source[$key]) > 2000) {
            respond(400, ['error' => 'Invalid image source']);
        }
    }
    $licenseUrl = $source['license_url'] ?? null;
    if (($licenseUrl !== null && (!is_string($licenseUrl) || strlen($licenseUrl) > 2000))
        || !filter_var($source['page'], FILTER_VALIDATE_URL)
        || !str_starts_with($source['page'], 'https://')
        || ($licenseUrl !== null && (!filter_var($licenseUrl, FILTER_VALIDATE_URL)
            || !str_starts_with($licenseUrl, 'https://')))
        || $source['license'] === '') {
        respond(400, ['error' => 'Invalid image source']);
    }
    return $source;
}

function saveMediaSource($db, int $imageId, array $source): void
{
    $saved = @pg_query_params($db,
        'INSERT INTO public.image_source
            (image_id, source_page, creator, license_name, license_url, attribution)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (image_id) DO NOTHING',
        [$imageId, $source['page'], $source['creator'], $source['license'],
         $source['license_url'], $source['attribution']]);
    if ($saved === false) respond(500, ['error' => 'Failed to save image source']);
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

function mediaImageByHash($db, int $authUserId, string $hash, bool $reuseShared = true): ?array
{
    $result = @pg_query_params($db,
        'SELECT i.id, i.original_name, i.shared, i.group_id, b.mime_type, b.width, b.height,
                b.size_bytes AS size_bytes,
                s.source_page, s.creator, s.license_name, s.license_url, s.attribution
         FROM public.image i JOIN public.image_blob b ON b.id = i.blob_id
         LEFT JOIN public.image_source s ON s.image_id = i.id
         WHERE b.sha256 = $1 AND (i.owner_auth_user_id = $2 OR ($3::boolean AND i.shared = TRUE))
         ORDER BY i.shared DESC LIMIT 1',
        [$hash, $authUserId, $reuseShared ? 'true' : 'false']);
    if ($result === false) respond(500, ['error' => 'Failed to save image']);
    $row = pg_fetch_assoc($result);
    return $row === false ? null : publicMediaImage($row);
}

function mediaBlobId($db, string $hash, string $bytes, string $mime, int $width, int $height): string
{
    try {
        mediaStorageWrite('images', $hash, $bytes);
    } catch (RuntimeException $error) {
        error_log($error->getMessage());
        respond(500, ['error' => 'Failed to save image']);
    }
    $existing = @pg_query_params($db,
        'SELECT id FROM public.image_blob WHERE sha256 = $1', [$hash]);
    if ($existing === false) respond(500, ['error' => 'Failed to save image']);
    if (pg_num_rows($existing) > 0) return pg_fetch_result($existing, 0, 'id');

    [$thumbnailMime, $thumbnailBytes] = mediaThumbnail($bytes, $mime, $width, $height);
    try {
        mediaStorageWrite('thumbnails', $hash, $thumbnailBytes);
    } catch (RuntimeException $error) {
        error_log($error->getMessage());
        respond(500, ['error' => 'Failed to save image thumbnail']);
    }
    $insert = @pg_query_params($db,
        'INSERT INTO public.image_blob (sha256, mime_type, width, height, size_bytes,
                                        thumbnail_mime_type)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (sha256) DO NOTHING',
        [$hash, $mime, $width, $height, strlen($bytes), $thumbnailMime]);
    $blob = $insert === false ? false : @pg_query_params($db,
        'SELECT id FROM public.image_blob WHERE sha256 = $1', [$hash]);
    $blobId = $blob === false ? false : pg_fetch_result($blob, 0, 'id');
    if ($blobId === false) respond(500, ['error' => 'Failed to save image']);
    return $blobId;
}

function mediaThumbnail(string $bytes, string $mime, int $width, int $height): array
{
    if ($width <= MEDIA_THUMBNAIL_MAX_SIDE && $height <= MEDIA_THUMBNAIL_MAX_SIDE
        && strlen($bytes) <= 32768) {
        return [$mime, $bytes];
    }
    if (!function_exists('imagecreatefromstring') || !function_exists('imagewebp')) {
        respond(500, ['error' => 'Image thumbnails are unavailable']);
    }
    $source = @imagecreatefromstring($bytes);
    if ($source === false) respond(400, ['error' => 'Could not decode image']);
    $scale = min(1, MEDIA_THUMBNAIL_MAX_SIDE / max($width, $height));
    $targetWidth = max(1, (int) round($width * $scale));
    $targetHeight = max(1, (int) round($height * $scale));
    $target = imagecreatetruecolor($targetWidth, $targetHeight);
    if ($target === false) respond(500, ['error' => 'Could not create image thumbnail']);
    imagealphablending($target, false);
    imagesavealpha($target, true);
    $transparent = imagecolorallocatealpha($target, 0, 0, 0, 127);
    imagefill($target, 0, 0, $transparent);
    if (!imagecopyresampled($target, $source, 0, 0, 0, 0,
        $targetWidth, $targetHeight, $width, $height)) {
        respond(500, ['error' => 'Could not create image thumbnail']);
    }
    ob_start();
    $encoded = @imagewebp($target, null, 75);
    $thumbnail = ob_get_clean();
    if (!$encoded || !is_string($thumbnail) || $thumbnail === '') {
        respond(500, ['error' => 'Could not encode image thumbnail']);
    }
    return ['image/webp', $thumbnail];
}

function saveMediaImage($db, int $authUserId, string $name, string $bytes,
    string $mime, int $width, int $height, ?array &$createdIds = null,
    bool $reuseShared = true): array
{
    $hash = hash('sha256', $bytes);
    $existing = mediaImageByHash($db, $authUserId, $hash, $reuseShared);
    if ($existing !== null) {
        try {
            mediaStorageWrite('images', $hash, $bytes);
        } catch (RuntimeException $error) {
            error_log($error->getMessage());
            respond(500, ['error' => 'Failed to save image']);
        }
        return $existing;
    }

    $usage = @pg_query_params($db,
            'SELECT COUNT(*) AS total, COALESCE(SUM(b.size_bytes), 0) AS bytes
             FROM public.image i JOIN public.image_blob b ON b.id = i.blob_id
             WHERE i.owner_auth_user_id = $1', [$authUserId]);
    if ($usage === false) respond(500, ['error' => 'Failed to save image']);
    $used = pg_fetch_assoc($usage);
    if ((int) $used['total'] >= MEDIA_PERSONAL_MAX_COUNT
        || (int) $used['bytes'] + strlen($bytes) > MEDIA_PERSONAL_MAX_BYTES) {
        respond(409, ['error' => 'Image library is full (' . MEDIA_PERSONAL_MAX_COUNT . ' images or 64 MiB)']);
    }

    $blobId = mediaBlobId($db, $hash, $bytes, $mime, $width, $height);

    $insert = @pg_query_params($db,
        'INSERT INTO public.image (blob_id, owner_auth_user_id, uploaded_by_auth_user_id, shared, original_name)
         VALUES ($1, $2, $2, FALSE, $3) ON CONFLICT DO NOTHING',
        [$blobId, $authUserId, $name]);
    if ($insert === false) respond(500, ['error' => 'Failed to save image']);
    $stored = @pg_query_params($db,
        'SELECT i.id, i.original_name, i.shared, i.group_id, b.mime_type, b.width, b.height,
                b.size_bytes AS size_bytes
         FROM public.image i JOIN public.image_blob b ON b.id = i.blob_id
         WHERE i.blob_id = $1 AND i.owner_auth_user_id = $2
         LIMIT 1', [$blobId, $authUserId]);
    $row = $stored === false ? false : pg_fetch_assoc($stored);
    if ($row === false) respond(500, ['error' => 'Failed to save image']);
    if ($createdIds !== null && pg_affected_rows($insert) === 1) {
        $createdIds[] = (int) $row['id'];
    }
    return publicMediaImage($row);
}

function listMediaImages(bool $mineOnly): never
{
    $user = currentSessionUser();
    $db = connectMediaDb();
    $result = @pg_query_params($db,
        'SELECT i.id, i.original_name, i.shared, i.group_id, b.mime_type, b.width, b.height,
                b.size_bytes AS size_bytes,
                s.source_page, s.creator, s.license_name, s.license_url, s.attribution
         FROM public.image i JOIN public.image_blob b ON b.id = i.blob_id
         LEFT JOIN public.image_source s ON s.image_id = i.id
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
    $forApp = $_GET['for'] ?? null;
    $serviceId = null;
    $resourceId = null;
    if ($forApp !== null) {
        $resourceId = isset($_GET['resource_id'])
            ? filter_var($_GET['resource_id'], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]) : null;
        if (!is_string($forApp) || !(TOKEN_APPS[$forApp]['owner_image_upload'] ?? false)
            || !isset($user['api_token_id']) || $resourceId === false
            || tokenOwnerAccess($user, $forApp, $resourceId, true) === null) {
            respond(403, ['error' => 'API token cannot upload to the owner image library']);
        }
        $serviceId = (int) $user['id'];
        $user = appAccessUser($user, $forApp, true, $resourceId);
    }
    [$name, $bytes, $mime, $width, $height] = readMediaUpload();
    $db = connectMediaDb();
    if (@pg_query($db, 'BEGIN') === false) respond(500, ['error' => 'Failed to save image']);
    $lock = @pg_query_params($db, 'SELECT pg_advisory_xact_lock($1)', [$user['id']]);
    if ($lock === false) respond(500, ['error' => 'Failed to save image']);
    ensureMediaAccountActive((int) $user['id']);
    $image = saveMediaImage($db, (int) $user['id'], $name, $bytes, $mime, $width, $height);
    if ($serviceId !== null && @pg_query_params($db,
        'INSERT INTO public.api_token_image_access
            (service_auth_user_id, app, resource_id, image_id)
         VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
        [$serviceId, $forApp, $resourceId ?? 0, $image['id']]) === false) {
        respond(500, ['error' => 'Failed to record token image access']);
    }
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
                b.size_bytes AS size_bytes
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
                b.size_bytes AS size_bytes
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

function imageUsedByAccessibleQuiz(int $imageId, array $user): bool
{
    $quizDb = connectQuizDb();
    $result = @pg_query_params($quizDb,
        'SELECT EXISTS (
            SELECT 1 FROM public.quiz_attempt_question s
            JOIN public.quiz_attempt a ON a.id = s.attempt_id
            JOIN public.quiz_attempt_source b ON b.attempt_id = s.attempt_id AND b.question_id = s.source_question_id
            JOIN public."user" u ON u.id = a.user_id
            JOIN public.quiz q ON q.id = a.quiz_id
            JOIN public."user" owner ON owner.id = q.user_id
            LEFT JOIN public.quiz_answer r ON r.attempt_id = s.attempt_id AND r.question_id = s.id
            WHERE u.auth_user_id = $4 AND (a.completed IS NOT NULL OR s.position <= GREATEST(1, a.furthest_position))
              AND ($5::boolean OR q.is_public = TRUE OR owner.auth_user_id = $4
                OR (owner.auth_user_id = $6 AND ($7::boolean OR q.id = ANY($8::bigint[]))))
              AND (jsonb_path_exists(b.config, $1::jsonpath, jsonb_build_object(\'id\', $3::bigint))
                OR ((a.completed IS NOT NULL AND q.show_correct_answers = TRUE
                    OR b.template = \'show_answer\' AND r.answer->>\'revealed\' = \'true\')
                  AND jsonb_path_exists(b.config, $2::jsonpath, jsonb_build_object(\'id\', $3::bigint))))
         ) AS visible',
        [QUIZ_VISIBLE_IMAGE_REFERENCE_PATH, QUIZ_ANSWER_IMAGE_REFERENCE_PATH, $imageId,
         $user['id'], ($user['account_kind'] ?? 'human') === 'human' ? 't' : 'f',
         $user['service_owner_id'] ?? null, ($user['quiz_read_owner_id'] ?? null) !== null ? 't' : 'f',
         '{' . implode(',', readableQuizGrantIds($user)) . '}']);
    if ($result === false) respond(500, ['error' => 'Failed to check quiz image']);
    return pg_fetch_result($result, 0, 'visible') === 't';
}

function imageUsedByReadableOwnerQuiz(int $imageId, array $user): bool
{
    $ownerAuthUserId = $user['service_owner_id'] ?? null;
    if ($ownerAuthUserId === null) return false;
    $quizDb = connectQuizDb();
    $result = @pg_query_params($quizDb,
        'SELECT DISTINCT quiz.id FROM public.question question
            JOIN public.quiz quiz ON quiz.id = question.quiz_id
            JOIN public."user" owner ON owner.id = quiz.user_id
            WHERE owner.auth_user_id = $1
              AND jsonb_path_exists(question.config, $2::jsonpath,
                  jsonb_build_object(\'id\', $3::bigint))',
        [$ownerAuthUserId, QUIZ_IMAGE_REFERENCE_PATH, $imageId]);
    if ($result === false) respond(500, ['error' => 'Failed to check quiz image']);
    while (($row = pg_fetch_assoc($result)) !== false) {
        if (quizGrantOwnerId($user, (int) $row['id']) !== null) return true;
    }
    return false;
}

function imageUsedByReadableOwnerApp(int $imageId, array $user): bool
{
    return tokenUploadedOwnerImage($imageId, $user)
        || tokenReferencedOwnerImage($imageId, $user, 'musico')
        || tokenReferencedOwnerImage($imageId, $user, 'mdb');
}

function storedMediaThumbnail($db, array $row): array
{
    $hash = trim($row['sha256']);
    try {
        if (is_file(mediaStoragePath('thumbnails', $hash))) {
            $stored = mediaStorageRead('thumbnails', $hash);
            if ($row['thumbnail_mime_type'] !== null) {
                return [$row['thumbnail_mime_type'], $stored];
            }
            $mime = @getimagesizefromstring($stored)['mime'] ?? null;
            if (in_array($mime, ['image/png', 'image/jpeg', 'image/webp'], true)) {
                $bytes = $stored;
            } else {
                throw new RuntimeException('Stored image thumbnail is invalid');
            }
        } else {
            $original = mediaStorageRead('images', $hash);
            [$mime, $bytes] = mediaThumbnail($original, $row['mime_type'],
                (int) $row['width'], (int) $row['height']);
            mediaStorageWrite('thumbnails', $hash, $bytes);
        }
    } catch (RuntimeException $error) {
        error_log($error->getMessage());
        respond(500, ['error' => 'Could not load image thumbnail']);
    }
    $saved = @pg_query_params($db,
        'UPDATE public.image_blob SET thumbnail_mime_type = $2 WHERE id = $1',
        [$row['blob_id'], $mime]);
    if ($saved === false) respond(500, ['error' => 'Could not save image thumbnail']);
    return [$mime, $bytes];
}

function handleGetImage(int $imageId, bool $thumbnail = false): never
{
    $user = currentSessionUser();
    $db = connectMediaDb();
    $columns = 'b.id AS blob_id, b.sha256, b.mime_type, b.width, b.height,
                b.size_bytes, b.thumbnail_mime_type';
    $result = @pg_query_params($db,
        'SELECT i.original_name, ' . $columns . '
         FROM public.image i JOIN public.image_blob b ON b.id = i.blob_id
         WHERE i.id = $1 AND (i.owner_auth_user_id = $2 OR i.shared = TRUE)',
        [$imageId, $user['id']]);
    if ($result === false) respond(500, ['error' => 'Failed to load image']);
    $row = pg_fetch_assoc($result);
    if ($row === false) {
        $readOwnerId = $user['service_owner_id'] ?? null;
        $ownerImage = imageUsedByReadableOwnerQuiz($imageId, $user)
            || imageUsedByReadableOwnerApp($imageId, $user);
        if (!$ownerImage && !imageUsedByAccessibleQuiz($imageId, $user)) {
            respond(404, ['error' => 'Image not found']);
        }
        $result = @pg_query_params($db,
            'SELECT i.original_name, ' . $columns . '
             FROM public.image i JOIN public.image_blob b ON b.id = i.blob_id
             WHERE i.id = $1 AND ($2::boolean = FALSE OR i.owner_auth_user_id = $3)',
            [$imageId, $ownerImage ? 't' : 'f', $readOwnerId]);
        if ($result === false) respond(500, ['error' => 'Failed to load image']);
        $row = pg_fetch_assoc($result);
        if ($row === false) respond(404, ['error' => 'Image not found']);
    }
    if ($thumbnail) {
        [$mime, $bytes] = storedMediaThumbnail($db, $row);
    } else {
        $mime = $row['mime_type'];
        try {
            $bytes = mediaStorageRead('images', $row['sha256']);
        } catch (RuntimeException $error) {
            error_log($error->getMessage());
            respond(500, ['error' => 'Could not load image']);
        }
        if (strlen($bytes) !== (int) $row['size_bytes']) {
            respond(500, ['error' => 'Stored image size does not match metadata']);
        }
        header("Content-Disposition: inline; filename*=UTF-8''" . rawurlencode($row['original_name']));
    }
    header('Content-Type: ' . $mime);
    header('X-Content-Type-Options: nosniff');
    header('Cache-Control: private, no-store');
    echo $bytes;
    exit;
}

function handleGetMediaThumbnails(): never
{
    $user = currentSessionUser();
    $payload = readJsonBody(1024);
    $ids = $payload['image_ids'] ?? null;
    if (!is_array($ids) || !array_is_list($ids) || $ids === [] || count($ids) > 32) {
        respond(400, ['error' => 'Choose 1 to 32 images']);
    }
    foreach ($ids as $id) {
        if (!is_int($id) || $id < 1) respond(400, ['error' => 'Invalid image ID']);
    }
    if (count(array_unique($ids)) !== count($ids)) respond(400, ['error' => 'Duplicate image ID']);

    $db = connectMediaDb();
    $result = @pg_query_params($db,
        'SELECT i.id, b.id AS blob_id, b.sha256, b.mime_type, b.width, b.height,
                b.thumbnail_mime_type
         FROM public.image i JOIN public.image_blob b ON b.id = i.blob_id
         WHERE i.id = ANY($1::bigint[])
           AND (i.owner_auth_user_id = $2 OR i.shared = TRUE)',
        ['{' . implode(',', $ids) . '}', $user['id']]);
    if ($result === false) respond(500, ['error' => 'Failed to load thumbnails']);
    $images = [];
    while (($row = pg_fetch_assoc($result)) !== false) {
        [$mime, $bytes] = storedMediaThumbnail($db, $row);
        $images[] = ['id' => (int) $row['id'], 'mime_type' => $mime,
            'data' => base64_encode($bytes)];
    }
    if (($user['service_owner_id'] ?? null) !== null) {
        $found = array_column($images, null, 'id');
        foreach ($ids as $id) {
            if (isset($found[$id]) || !imageUsedByReadableOwnerApp($id, $user)) continue;
            $ownerImage = @pg_query_params($db,
                'SELECT i.id, b.id AS blob_id, b.sha256, b.mime_type, b.width, b.height,
                        b.thumbnail_mime_type
                 FROM public.image i JOIN public.image_blob b ON b.id = i.blob_id
                 WHERE i.id = $1 AND i.owner_auth_user_id = $2',
                [$id, $user['service_owner_id']]);
            if ($ownerImage === false) respond(500, ['error' => 'Failed to load thumbnails']);
            $row = pg_fetch_assoc($ownerImage);
            if ($row === false) continue;
            [$mime, $bytes] = storedMediaThumbnail($db, $row);
            $images[] = ['id' => $id, 'mime_type' => $mime, 'data' => base64_encode($bytes)];
        }
    }
    header('Cache-Control: private, no-store');
    respond(200, ['images' => $images]);
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
                b.size_bytes AS size_bytes
         FROM renamed i JOIN public.image_blob b ON b.id = i.blob_id',
        [$name, $imageId, $user['id'], $user['role'] === 'admin' ? 'true' : 'false']);
    if ($result === false) respond(500, ['error' => 'Failed to rename image']);
    $row = pg_fetch_assoc($result);
    if ($row === false) respond(404, ['error' => 'Image not found']);
    respond(200, publicMediaImage($row));
}

function requestedMediaImageIds(): array
{
    $payload = readJsonBody(131072);
    $ids = $payload['image_ids'] ?? null;
    if (!is_array($ids) || !array_is_list($ids) || $ids === [] || count($ids) > 5000) {
        respond(400, ['error' => 'Choose images to delete']);
    }
    foreach ($ids as $id) {
        if (!is_int($id) || $id < 1) respond(400, ['error' => 'Invalid image ID']);
    }
    if (count(array_unique($ids)) !== count($ids)) {
        respond(400, ['error' => 'Duplicate image ID']);
    }
    return $ids;
}

function authorizedMediaImageRows($db, array $user, array $ids): array
{
    $result = @pg_query_params($db,
        'SELECT id, original_name, shared, owner_auth_user_id FROM public.image
         WHERE id = ANY($1::bigint[])', ['{' . implode(',', $ids) . '}']);
    if ($result === false) respond(500, ['error' => 'Failed to check images']);
    $rows = [];
    while (($row = pg_fetch_assoc($result)) !== false) $rows[(int) $row['id']] = $row;
    foreach ($ids as $id) {
        $row = $rows[$id] ?? null;
        if ($row === null || ($row['shared'] !== 't'
            && (int) $row['owner_auth_user_id'] !== (int) $user['id'])) {
            respond(404, ['error' => 'Image not found']);
        }
        if ($row['shared'] === 't' && $user['role'] !== 'admin') {
            respond(403, ['error' => 'Admin access required']);
        }
    }
    return $rows;
}

function imageUsageRows($quizDb, array $user, int $imageId, bool $shared): array
{
    $result = @pg_query_params($quizDb,
        'SELECT \'question\' AS kind, q.id AS quiz_id, q.name AS quiz_name,
                t.id AS question_id, t.prompt, NULL::bigint AS attempt_id
         FROM public.question t JOIN public.quiz q ON q.id = t.quiz_id
         JOIN public."user" u ON u.id = q.user_id
         WHERE ($3::boolean OR u.auth_user_id = $4)
           AND jsonb_path_exists(t.config, $1::jsonpath, jsonb_build_object(\'id\', $2::bigint))
         UNION ALL
         SELECT \'attempt\' AS kind, q.id AS quiz_id, q.name AS quiz_name,
                s.question_id, s.prompt, s.attempt_id
         FROM public.quiz_attempt_source s
         JOIN public.quiz_attempt a ON a.id = s.attempt_id
         JOIN public.quiz q ON q.id = a.quiz_id
         JOIN public."user" u ON u.id = q.user_id
         WHERE ($3::boolean OR u.auth_user_id = $4)
           AND jsonb_path_exists(s.config, $1::jsonpath, jsonb_build_object(\'id\', $2::bigint))
         ORDER BY quiz_id, kind, attempt_id, question_id',
        [QUIZ_IMAGE_REFERENCE_PATH, $imageId, $shared ? 't' : 'f', $user['id']]);
    if ($result === false) respond(500, ['error' => 'Failed to check image usage']);
    $uses = [];
    while (($row = pg_fetch_assoc($result)) !== false) {
        $uses[] = [
            'kind' => $row['kind'], 'quiz_id' => (int) $row['quiz_id'],
            'quiz_name' => $row['quiz_name'], 'question_id' => (int) $row['question_id'],
            'question_prompt' => $row['prompt'],
            'attempt_id' => $row['attempt_id'] === null ? null : (int) $row['attempt_id'],
        ];
    }
    return $uses;
}

function musicoImageUsageRows($musicoDb, array $user, int $imageId, bool $shared): array
{
    $result = @pg_query_params($musicoDb,
        'SELECT t.id, t.title FROM public.track t JOIN public."user" u ON u.id = t.user_id
         WHERE t.art_image_id = $1 AND ($2::boolean OR u.auth_user_id = $3)
         ORDER BY t.id', [$imageId, $shared ? 't' : 'f', $user['id']]);
    if ($result === false) respond(500, ['error' => 'Failed to check image usage']);
    $uses = [];
    while (($row = pg_fetch_assoc($result)) !== false) {
        $uses[] = ['kind' => 'musico_track', 'track_id' => (int) $row['id'], 'track_name' => $row['title']];
    }
    return $uses;
}

function mdbImageUsageRows($mdbDb, array $user, int $imageId, bool $shared): array
{
    $result = @pg_query_params($mdbDb,
        'SELECT d.id AS database_id, d.name AS database_name,
                r.id AS row_id, r.position AS row_position, c.name AS column_name
         FROM public.database_cell v
         JOIN public.database_column c ON c.id = v.column_id AND c.database_id = v.database_id
         JOIN public.database_row r ON r.id = v.row_id AND r.database_id = v.database_id
         JOIN public.user_database d ON d.id = v.database_id
         JOIN public."user" u ON u.id = d.user_id
         WHERE c.type = \'image\' AND v.value = $1::text
           AND ($2::boolean OR u.auth_user_id = $3)
         ORDER BY d.name, r.position, c.position',
        [$imageId, $shared ? 't' : 'f', $user['id']]);
    if ($result === false) respond(500, ['error' => 'Failed to check image usage']);
    $uses = [];
    while (($row = pg_fetch_assoc($result)) !== false) {
        $uses[] = ['kind' => 'mdb_cell',
            'database_id' => (int) $row['database_id'], 'database_name' => $row['database_name'],
            'row_id' => (int) $row['row_id'], 'row_position' => (int) $row['row_position'],
            'column_name' => $row['column_name']];
    }
    return $uses;
}

function handleImageUsage(): never
{
    $user = currentSessionUser();
    $ids = requestedMediaImageIds();
    $db = connectMediaDb();
    $rows = authorizedMediaImageRows($db, $user, $ids);
    $quizDb = connectQuizDb();
    $musicoDb = connectMusicoDb();
    $mdbDb = connectMdbDb();
    $images = [];
    foreach ($ids as $id) {
        $row = $rows[$id];
        $images[] = [
            'id' => $id, 'name' => $row['original_name'],
            'scope' => $row['shared'] === 't' ? 'shared' : 'personal',
            'uses' => array_merge(
                imageUsageRows($quizDb, $user, $id, $row['shared'] === 't'),
                musicoImageUsageRows($musicoDb, $user, $id, $row['shared'] === 't'),
                mdbImageUsageRows($mdbDb, $user, $id, $row['shared'] === 't')
            ),
        ];
    }
    respond(200, ['images' => $images]);
}

function handleDeleteImage(int $imageId): never
{
    $user = currentSessionUser();
    $force = $_GET['force'] ?? null;
    if ($force !== null && $force !== '1') respond(400, ['error' => 'Invalid force option']);
    $db = connectMediaDb();
    $image = @pg_query_params($db,
        'SELECT shared, owner_auth_user_id FROM public.image WHERE id = $1', [$imageId]);
    if ($image === false) respond(500, ['error' => 'Failed to delete image']);
    $row = pg_fetch_assoc($image);
    if ($row === false || ($row['shared'] !== 't' && (int) $row['owner_auth_user_id'] !== (int) $user['id'])) {
        respond(404, ['error' => 'Image not found']);
    }
    $shared = $row['shared'] === 't';
    if ($shared && $user['role'] !== 'admin') respond(403, ['error' => 'Admin access required']);
    // Question writes take an image lock before checking image access. A
    // personal image also uses its owner's lock for existing import flows.
    $quizDb = connectQuizDb();
    if (@pg_query($quizDb, 'BEGIN') === false
        || @pg_query_params($quizDb, 'SELECT pg_advisory_xact_lock($1::bigint)', [$shared ? -$imageId : $user['id']]) === false) {
        respond(500, ['error' => 'Failed to delete image']);
    }
    $used = @pg_query_params($quizDb,
        'SELECT EXISTS (
            SELECT 1 FROM public.question t JOIN public.quiz q ON q.id = t.quiz_id
            JOIN public."user" u ON u.id = q.user_id
            WHERE ($4::boolean OR u.auth_user_id = $1) AND jsonb_path_exists(t.config, $2::jsonpath,
              jsonb_build_object(\'id\', $3::bigint))
         ) OR EXISTS (
            SELECT 1 FROM public.quiz_attempt_source s
            JOIN public.quiz_attempt a ON a.id = s.attempt_id
            JOIN public.quiz q ON q.id = a.quiz_id
            JOIN public."user" u ON u.id = q.user_id
            WHERE ($4::boolean OR u.auth_user_id = $1) AND jsonb_path_exists(s.config, $2::jsonpath,
              jsonb_build_object(\'id\', $3::bigint))
         ) AS used',
        [$user['id'],
         QUIZ_IMAGE_REFERENCE_PATH,
         $imageId, $shared ? 't' : 'f']);
    if ($used === false) respond(500, ['error' => 'Failed to delete image']);
    $musicoDb = connectMusicoDb();
    if (@pg_query($musicoDb, 'BEGIN') === false
        || (!$shared && @pg_query_params($musicoDb, 'SELECT pg_advisory_xact_lock($1::bigint)', [$user['id']]) === false)
        || @pg_query_params($musicoDb, 'SELECT pg_advisory_xact_lock($1::bigint)', [-$imageId]) === false) {
        respond(500, ['error' => 'Failed to delete image']);
    }
    $musicoUsed = @pg_query_params($musicoDb,
        'SELECT EXISTS (SELECT 1 FROM public.track t JOIN public."user" u ON u.id = t.user_id
          WHERE t.art_image_id = $1 AND ($2::boolean OR u.auth_user_id = $3)) AS used',
        [$imageId, $shared ? 't' : 'f', $user['id']]);
    if ($musicoUsed === false) respond(500, ['error' => 'Failed to delete image']);
    $mdbDb = connectMdbDb();
    if (@pg_query($mdbDb, 'BEGIN') === false
        || (!$shared && @pg_query_params($mdbDb, 'SELECT pg_advisory_xact_lock($1::bigint)', [$user['id']]) === false)
        || @pg_query_params($mdbDb, 'SELECT pg_advisory_xact_lock($1::bigint)', [-$imageId]) === false) {
        respond(500, ['error' => 'Failed to delete image']);
    }
    $mdbUsed = @pg_query_params($mdbDb,
        'SELECT EXISTS (SELECT 1 FROM public.database_cell v
          JOIN public.database_column c ON c.id = v.column_id AND c.database_id = v.database_id
          JOIN public.user_database d ON d.id = v.database_id
          JOIN public."user" u ON u.id = d.user_id
          WHERE c.type = \'image\' AND v.value = $1::text
            AND ($2::boolean OR u.auth_user_id = $3)) AS used',
        [$imageId, $shared ? 't' : 'f', $user['id']]);
    if ($mdbUsed === false) respond(500, ['error' => 'Failed to delete image']);
    if ($force !== '1' && (pg_fetch_result($used, 0, 'used') === 't'
        || pg_fetch_result($musicoUsed, 0, 'used') === 't'
        || pg_fetch_result($mdbUsed, 0, 'used') === 't')) {
        respond(409, ['error' => 'Image is in use']);
    }

    if (@pg_query($db, 'BEGIN') === false) respond(500, ['error' => 'Failed to delete image']);
    $deleted = @pg_query_params($db,
        'DELETE FROM public.image WHERE id = $1 AND (owner_auth_user_id = $2
           OR (shared = TRUE AND $3::boolean)) RETURNING blob_id',
        [$imageId, $user['id'], $shared && $user['role'] === 'admin' ? 't' : 'f']);
    if ($deleted === false) respond(500, ['error' => 'Failed to delete image']);
    $imageRow = pg_fetch_assoc($deleted);
    if ($imageRow === false) respond(404, ['error' => 'Image not found']);
    if (@pg_query_params($db,
            'DELETE FROM public.image_blob b WHERE b.id = $1
             AND NOT EXISTS (SELECT 1 FROM public.image i WHERE i.blob_id = b.id)',
            [$imageRow['blob_id']]) === false
        || @pg_query($db, 'COMMIT') === false
        || @pg_query($quizDb, 'COMMIT') === false
        || @pg_query($musicoDb, 'COMMIT') === false
        || @pg_query($mdbDb, 'COMMIT') === false) {
        respond(500, ['error' => 'Failed to delete image']);
    }
    header_remove('Content-Type');
    http_response_code(204);
    exit;
}
