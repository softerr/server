<?php
declare(strict_types=1);

const QUIZ_IMPORT_MAX_BYTES = 50331648;
const QUIZ_IMPORT_MAX_IMAGES = 4096;

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

