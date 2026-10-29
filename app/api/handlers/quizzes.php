<?php
declare(strict_types=1);

function publicQuiz(array $quiz): array
{
    return [
        'id' => (int) $quiz['id'],
        'name' => $quiz['name'],
        'description' => $quiz['description'],
        'play_style' => $quiz['play_style'],
        'show_correct_answers' => $quiz['show_correct_answers'] === 't',
        'randomize_questions' => $quiz['randomize_questions'] === 't',
        'question_limit' => $quiz['question_limit'] === null ? null : (int) $quiz['question_limit'],
        'created' => $quiz['created'],
    ];
}

function handleListQuizzes(): never
{
    $user = currentSessionUser();
    $db = connectQuizDb();
    $result = @pg_query_params(
        $db,
        'SELECT q.id, q.name, q.description, q.play_style, q.show_correct_answers, q.randomize_questions, q.question_limit, q.created
         FROM public.quiz q JOIN public."user" u ON u.id = q.user_id
         WHERE u.auth_user_id = $1 ORDER BY q.id DESC',
        [$user['id']]
    );
    if ($result === false) {
        respond(500, ['error' => 'Failed to load quizzes']);
    }

    $quizzes = [];
    while ($quiz = pg_fetch_assoc($result)) {
        $quizzes[] = publicQuiz($quiz);
    }
    respond(200, ['quizzes' => $quizzes]);
}

function handleGetQuiz(int $quizId): never
{
    $user = currentSessionUser();
    $db = connectQuizDb();
    $result = @pg_query_params(
        $db,
        'SELECT q.id, q.name, q.description, q.play_style, q.show_correct_answers, q.randomize_questions, q.question_limit, q.created
         FROM public.quiz q JOIN public."user" u ON u.id = q.user_id
         WHERE q.id = $1 AND u.auth_user_id = $2',
        [$quizId, $user['id']]
    );
    if ($result === false) {
        respond(500, ['error' => 'Failed to load quiz']);
    }
    $quiz = pg_fetch_assoc($result);
    if ($quiz === false) {
        respond(404, ['error' => 'Quiz not found']);
    }
    respond(200, publicQuiz($quiz));
}

function readQuizFields(?array $payload, bool $updating = false): array
{
    if ($payload === null || !is_string($payload['name'] ?? null)) {
        respond(400, ['error' => 'Quiz name is required']);
    }
    $name = trim($payload['name']);
    if ($name === '' || strlen($name) > 100) {
        respond(400, ['error' => 'Quiz name must be between 1 and 100 bytes']);
    }
    $hasDescription = array_key_exists('description', $payload);
    $description = $hasDescription ? $payload['description'] : ($updating ? null : '');
    if ($hasDescription && !is_string($description)) {
        respond(400, ['error' => 'Quiz description must be at most 1000 bytes']);
    }
    if ($description !== null && strlen(trim($description)) > 1000) {
        respond(400, ['error' => 'Quiz description must be at most 1000 bytes']);
    }
    $playStyle = array_key_exists('play_style', $payload)
        ? $payload['play_style'] : ($updating ? null : 'basic');
    if ($playStyle !== null && !in_array($playStyle, ['basic', 'game_show'], true)) {
        respond(400, ['error' => 'Quiz play style must be basic or game_show']);
    }
    $hasShowCorrectAnswers = array_key_exists('show_correct_answers', $payload);
    $showCorrectAnswers = $hasShowCorrectAnswers
        ? $payload['show_correct_answers'] : ($updating ? null : false);
    if ($hasShowCorrectAnswers && !is_bool($showCorrectAnswers)) {
        respond(400, ['error' => 'Show correct answers must be a boolean']);
    }
    $randomize = array_key_exists('randomize_questions', $payload)
        ? $payload['randomize_questions'] : ($updating ? null : false);
    if (array_key_exists('randomize_questions', $payload) && !is_bool($randomize)) {
        respond(400, ['error' => 'Randomize questions must be a boolean']);
    }
    $questionLimit = array_key_exists('question_limit', $payload)
        ? $payload['question_limit'] : null;
    if ($questionLimit !== null && (!is_int($questionLimit) || $questionLimit < 0 || $questionLimit > 1000)) {
        respond(400, ['error' => 'Question limit must be All or an integer from 0 to 1000']);
    }
    $limitProvided = array_key_exists('question_limit', $payload);
    return [$name, $description === null ? null : trim($description), $playStyle,
        $showCorrectAnswers, $randomize, $questionLimit, $limitProvided];
}

function beginQuizCreation($db, array $user, string $error): string
{
    if (@pg_query($db, 'BEGIN') === false) {
        respond(500, ['error' => $error]);
    }
    $lock = @pg_query_params($db, 'SELECT pg_advisory_xact_lock($1)', [$user['id']]);
    if ($lock === false) {
        @pg_query($db, 'ROLLBACK');
        respond(500, ['error' => $error]);
    }
    // Deletion may start after the first session check but before this lock.
    // The deletion handler takes the same quiz lock before removing local data.
    $authDb = connectDb();
    $active = @pg_query_params(
        $authDb,
        'SELECT 1 FROM public."user" WHERE id = $1 AND verified = TRUE AND deleting = FALSE',
        [$user['id']]
    );
    if ($active === false) {
        @pg_query($db, 'ROLLBACK');
        respond(500, ['error' => $error]);
    }
    if (pg_num_rows($active) === 0) {
        @pg_query($db, 'ROLLBACK');
        respond(401, ['error' => 'Not authenticated']);
    }
    $owner = @pg_query_params(
        $db,
        'INSERT INTO public."user" (auth_user_id) VALUES ($1)
         ON CONFLICT (auth_user_id) DO NOTHING',
        [$user['id']]
    );
    $localUser = $owner === false ? false : @pg_query_params(
        $db,
        'SELECT id FROM public."user" WHERE auth_user_id = $1',
        [$user['id']]
    );
    if ($localUser === false || ($localUserId = pg_fetch_result($localUser, 0, 'id')) === false) {
        @pg_query($db, 'ROLLBACK');
        respond(500, ['error' => $error]);
    }
    $count = @pg_query_params(
        $db,
        'SELECT COUNT(*) AS total FROM public.quiz WHERE user_id = $1',
        [$localUserId]
    );
    if ($count === false) {
        @pg_query($db, 'ROLLBACK');
        respond(500, ['error' => $error]);
    }
    if ((int) pg_fetch_result($count, 0, 'total') >= 100) {
        @pg_query($db, 'ROLLBACK');
        respond(409, ['error' => 'Library is full (100 quizzes)']);
    }
    return $localUserId;
}

function insertQuizRow($db, string $localUserId, string $name, string $description, string $playStyle, bool $showCorrectAnswers, bool $randomize, ?int $questionLimit, string $error): array
{
    $result = @pg_query_params(
        $db,
        'INSERT INTO public.quiz (user_id, name, description, play_style, show_correct_answers, randomize_questions, question_limit)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, name, description, play_style, show_correct_answers, randomize_questions, question_limit, created',
        [$localUserId, $name, $description, $playStyle, $showCorrectAnswers ? 't' : 'f',
            $randomize ? 't' : 'f', $questionLimit]
    );
    if ($result === false) {
        @pg_query($db, 'ROLLBACK');
        respond(500, ['error' => $error]);
    }
    return publicQuiz(pg_fetch_assoc($result));
}

function handleCreateQuiz(): never
{
    $user = currentSessionUser();
    [$name, $description, $playStyle, $showCorrectAnswers, $randomize, $questionLimit] = readQuizFields(readJsonBody());
    $db = connectQuizDb();
    $error = 'Failed to create quiz';
    $localUserId = beginQuizCreation($db, $user, $error);
    $quiz = insertQuizRow($db, $localUserId, $name, $description, $playStyle, $showCorrectAnswers, $randomize, $questionLimit, $error);
    if (@pg_query($db, 'COMMIT') === false) {
        respond(500, ['error' => $error]);
    }
    respond(201, $quiz);
}

function remapQuizImageIds(array &$config, array $imageIds): void
{
    foreach ($config as $key => &$value) {
        if (is_string($key) && ($key === 'image_id' || str_ends_with($key, '_image_id'))) {
            if (!isset($imageIds[$value])) respond(400, ['error' => 'Quiz image is missing']);
            $value = $imageIds[$value];
        } elseif (is_array($value)) {
            remapQuizImageIds($value, $imageIds);
        }
    }
    unset($value);
}

function readZipQuizImport(): ?array
{
    if (!class_exists(ZipArchive::class)) respond(500, ['error' => 'ZIP support is unavailable']);
    $raw = file_get_contents('php://input', false, null, 0, QUIZ_IMPORT_MAX_BYTES + 1);
    if ($raw === false || strlen($raw) > QUIZ_IMPORT_MAX_BYTES) respond(413, ['error' => 'Request body is too large']);
    $path = tempnam(sys_get_temp_dir(), 'quiz-import-');
    if ($path === false) respond(500, ['error' => 'Could not read ZIP file']);
    register_shutdown_function(static fn () => @unlink($path));
    if (file_put_contents($path, $raw) !== strlen($raw)) {
        respond(500, ['error' => 'Could not read ZIP file']);
    }
    $zip = new ZipArchive();
    if ($zip->open($path, ZipArchive::CHECKCONS) !== true) {
        respond(400, ['error' => 'Invalid ZIP file']);
    }
    if ($zip->numFiles < 1 || $zip->numFiles > QUIZ_IMPORT_MAX_IMAGES + 1) {
        respond(400, ['error' => 'Invalid quiz ZIP contents']);
    }
    $names = [];
    $totalBytes = 0;
    for ($index = 0; $index < $zip->numFiles; $index++) {
        $entry = $zip->statIndex($index);
        if ($entry === false || isset($names[$entry['name']])) {
            respond(400, ['error' => 'Invalid quiz ZIP contents']);
        }
        $names[$entry['name']] = true;
        $totalBytes += $entry['size'];
        if ($totalBytes > QUIZ_IMPORT_MAX_BYTES) respond(413, ['error' => 'Quiz ZIP contents are too large']);
    }
    if (!isset($names['quiz.json'])) respond(400, ['error' => 'ZIP must contain quiz.json']);
    $manifest = $zip->getFromName('quiz.json', 4194305);
    if ($manifest === false || strlen($manifest) > 4194304) {
        respond(400, ['error' => 'Invalid quiz.json in ZIP']);
    }
    $payload = json_decode($manifest, true);
    if (!is_array($payload) || !is_array($payload['images'] ?? null)
        || !array_is_list($payload['images'])) {
        respond(400, ['error' => 'Invalid quiz.json in ZIP']);
    }
    $expected = ['quiz.json' => true];
    foreach ($payload['images'] as &$image) {
        if (!is_array($image) || !is_int($image['id'] ?? null) || $image['id'] < 1
            || !is_string($image['file'] ?? null) || !is_string($image['name'] ?? null)
            || isset($image['data'])
            || isset($expected[$image['file']]) || !isset($names[$image['file']])) {
            respond(400, ['error' => 'Invalid quiz image in ZIP']);
        }
        $imageName = validQuizImageName($image['name']);
        if ($image['file'] !== "images/{$image['id']}/{$imageName}") {
            respond(400, ['error' => 'Invalid quiz image in ZIP']);
        }
        $expected[$image['file']] = true;
        $bytes = $zip->getFromName($image['file'], MEDIA_IMAGE_MAX_BYTES + 1);
        if ($bytes === false) respond(400, ['error' => 'Invalid quiz image in ZIP']);
        validQuizImage($bytes);
        unset($image['file']);
        $image['data'] = base64_encode($bytes);
    }
    unset($image);
    if (count($expected) !== count($names)) {
        respond(400, ['error' => 'ZIP contains unexpected files']);
    }
    $zip->close();
    return $payload;
}

function readQuizImportDocument(): ?array
{
    $contentType = strtolower(trim(explode(';', $_SERVER['CONTENT_TYPE'] ?? '')[0]));
    if ($contentType === 'application/json') return readJsonBody(QUIZ_IMPORT_MAX_BYTES);
    if ($contentType === 'application/octet-stream' || $contentType === 'application/zip'
        || $contentType === 'application/x-zip-compressed') {
        return readZipQuizImport();
    }
    respond(415, ['error' => 'Use JSON or ZIP']);
}

function handleImportQuiz(): never
{
    $user = currentSessionUser();
    $payload = readQuizImportDocument();
    if ($payload === null || ($payload['format'] ?? null) !== 'softerr-quiz'
        || ($payload['version'] ?? null) !== 1
        || !is_string($payload['description'] ?? null)
        || !is_array($payload['questions'] ?? null)
        || !array_is_list($payload['questions'])
        || count($payload['questions']) > 100) {
        respond(400, ['error' => 'Invalid quiz export']);
    }
    [$name, $description, $playStyle, $showCorrectAnswers, $randomize, $questionLimit] = readQuizFields($payload);
    $questions = [];
    foreach ($payload['questions'] as $question) {
        if (!is_array($question)) {
            respond(400, ['error' => 'Invalid quiz question']);
        }
        $questions[] = readQuestionFields($question);
    }

    $images = $payload['images'] ?? null;
    if (!is_array($images) || !array_is_list($images) || count($images) > QUIZ_IMPORT_MAX_IMAGES) {
        respond(400, ['error' => 'Invalid quiz images']);
    }
    $decodedImages = [];
    $totalImageBytes = 0;
    foreach ($images as $image) {
        if (!is_array($image) || !is_int($image['id'] ?? null) || $image['id'] < 1
            || isset($decodedImages[$image['id']]) || !is_string($image['name'] ?? null)
            || !is_string($image['data'] ?? null)) {
            respond(400, ['error' => 'Invalid quiz image']);
        }
        $imageName = validQuizImageName($image['name']);
        $bytes = base64_decode($image['data'], true);
        if ($bytes === false) respond(400, ['error' => 'Invalid quiz image']);
        $totalImageBytes += strlen($bytes);
        if ($totalImageBytes > QUIZ_IMPORT_MAX_BYTES) respond(413, ['error' => 'Quiz images are too large']);
        [$mime, $width, $height] = validQuizImage($bytes);
        $decodedImages[$image['id']] = [$imageName, $bytes, $mime, $width, $height];
    }
    $referencedIds = [];
    foreach ($questions as [, , $config]) {
        array_push($referencedIds, ...imageIdsFromConfig(json_decode($config, true, 512, JSON_THROW_ON_ERROR)));
    }
    $referencedIds = array_values(array_unique($referencedIds));
    $providedIds = array_keys($decodedImages);
    sort($referencedIds);
    sort($providedIds);
    if ($referencedIds !== $providedIds) {
        respond(400, ['error' => 'Quiz images do not match question references']);
    }

    $db = connectQuizDb();
    $error = 'Failed to import quiz';
    $localUserId = beginQuizCreation($db, $user, $error);
    $mediaDb = connectMediaDb();
    if (@pg_query($mediaDb, 'BEGIN') === false
        || @pg_query_params($mediaDb, 'SELECT pg_advisory_xact_lock($1)', [$user['id']]) === false) {
        @pg_query($db, 'ROLLBACK');
        respond(500, ['error' => $error]);
    }
    ensureMediaAccountActive((int) $user['id']);
    $imageIds = [];
    foreach ($decodedImages as $oldId => [$imageName, $bytes, $mime, $width, $height]) {
        $stored = saveMediaImage($mediaDb, (int) $user['id'], $imageName, $bytes, $mime, $width, $height);
        $imageIds[$oldId] = $stored['id'];
    }
    $quiz = insertQuizRow($db, $localUserId, $name, $description, $playStyle, $showCorrectAnswers, $randomize, $questionLimit, $error);
    foreach ($questions as $position => [$template, $prompt, $config]) {
        $details = json_decode($config, true, 512, JSON_THROW_ON_ERROR);
        remapQuizImageIds($details, $imageIds);
        $config = json_encode((object) $details, JSON_THROW_ON_ERROR);
        $result = @pg_query_params(
            $db,
            'INSERT INTO public.question (quiz_id, template, prompt, config, position)
             VALUES ($1, $2, $3, $4::jsonb, $5)',
            [$quiz['id'], $template, $prompt, $config, $position + 1]
        );
        if ($result === false) {
            @pg_query($db, 'ROLLBACK');
            respond(500, ['error' => $error]);
        }
    }
    if (@pg_query($mediaDb, 'COMMIT') === false || @pg_query($db, 'COMMIT') === false) {
        respond(500, ['error' => $error]);
    }
    respond(201, $quiz);
}

function handleExportQuizZip(int $quizId): never
{
    if (!class_exists(ZipArchive::class)) respond(500, ['error' => 'ZIP support is unavailable']);
    $user = currentSessionUser();
    $db = connectQuizDb();
    $owner = @pg_query_params($db,
        'SELECT q.name, q.description, q.play_style, q.show_correct_answers, q.randomize_questions, q.question_limit, q.user_id FROM public.quiz q
         JOIN public."user" u ON u.id = q.user_id
         WHERE q.id = $1 AND u.auth_user_id = $2', [$quizId, $user['id']]);
    if ($owner === false) respond(500, ['error' => 'Failed to export quiz']);
    $quiz = pg_fetch_assoc($owner);
    if ($quiz === false) respond(404, ['error' => 'Quiz not found']);
    $result = @pg_query_params($db,
        'SELECT template, prompt, config FROM public.question
         WHERE quiz_id = $1 ORDER BY position, id', [$quizId]);
    if ($result === false) respond(500, ['error' => 'Failed to export quiz']);
    $questions = [];
    $imageIds = [];
    while ($row = pg_fetch_assoc($result)) {
        $config = json_decode($row['config'], true, 512, JSON_THROW_ON_ERROR);
        $questions[] = ['template' => $row['template'], 'prompt' => $row['prompt'], 'config' => $config];
        array_push($imageIds, ...imageIdsFromConfig($config));
    }
    $imageIds = array_values(array_unique($imageIds));
    $path = tempnam(sys_get_temp_dir(), 'quiz-export-');
    if ($path === false) respond(500, ['error' => 'Failed to export quiz']);
    register_shutdown_function(static fn () => @unlink($path));
    $zip = new ZipArchive();
    if ($zip->open($path, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
        respond(500, ['error' => 'Failed to export quiz']);
    }
    $manifest = [
        'format' => 'softerr-quiz', 'version' => 1,
        'name' => $quiz['name'], 'description' => $quiz['description'], 'play_style' => $quiz['play_style'],
        'show_correct_answers' => $quiz['show_correct_answers'] === 't',
        'randomize_questions' => $quiz['randomize_questions'] === 't',
        'question_limit' => $quiz['question_limit'] === null ? null : (int) $quiz['question_limit'],
        'questions' => $questions, 'images' => [],
    ];
    $mediaDb = connectMediaDb();
    foreach ($imageIds as $id) {
        $imageResult = @pg_query_params($mediaDb,
            'SELECT i.original_name, b.mime_type, b.content
             FROM public.image i JOIN public.image_blob b ON b.id = i.blob_id
             WHERE i.id = $1 AND (i.owner_auth_user_id = $2 OR i.shared = TRUE)',
            [$id, $user['id']]);
        if ($imageResult === false) respond(500, ['error' => 'Failed to export quiz']);
        $image = pg_fetch_assoc($imageResult);
        if ($image === false) respond(500, ['error' => 'Quiz image is missing']);
        $filename = "images/{$id}/{$image['original_name']}";
        if (!$zip->addFromString($filename, pg_unescape_bytea($image['content']))) {
            respond(500, ['error' => 'Failed to export quiz']);
        }
        $manifest['images'][] = ['id' => $id, 'name' => $image['original_name'], 'file' => $filename];
    }
    if (!$zip->addFromString('quiz.json', json_encode($manifest,
        JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR) . "\n")
        || !$zip->close()) {
        respond(500, ['error' => 'Failed to export quiz']);
    }
    header('Content-Type: application/zip');
    header('Content-Disposition: attachment; filename="quiz-' . $quizId . '.zip"');
    header('Content-Length: ' . filesize($path));
    header('Cache-Control: private, no-store');
    readfile($path);
    exit;
}

function handleUpdateQuiz(int $quizId): never
{
    $user = currentSessionUser();
    [$name, $description, $playStyle, $showCorrectAnswers, $randomize, $questionLimit, $limitProvided] = readQuizFields(readJsonBody(), true);

    $db = connectQuizDb();
    $result = @pg_query_params(
        $db,
        'UPDATE public.quiz q SET name = $1,
            description = COALESCE($2, q.description),
            play_style = COALESCE($3, q.play_style),
            show_correct_answers = COALESCE($4::boolean, q.show_correct_answers),
            randomize_questions = COALESCE($7::boolean, q.randomize_questions),
            question_limit = CASE WHEN $8::boolean THEN $9::integer ELSE q.question_limit END
         FROM public."user" u
         WHERE q.id = $5 AND q.user_id = u.id AND u.auth_user_id = $6
         RETURNING q.id, q.name, q.description, q.play_style, q.show_correct_answers, q.randomize_questions, q.question_limit, q.created',
        [$name, $description, $playStyle, $showCorrectAnswers === null ? null : ($showCorrectAnswers ? 't' : 'f'), $quizId, $user['id'],
            $randomize === null ? null : ($randomize ? 't' : 'f'), $limitProvided ? 't' : 'f', $questionLimit]
    );
    if ($result === false) {
        respond(500, ['error' => 'Failed to update quiz']);
    }
    $quiz = pg_fetch_assoc($result);
    if ($quiz === false) {
        respond(404, ['error' => 'Quiz not found']);
    }
    respond(200, publicQuiz($quiz));
}

function handleDeleteQuiz(int $quizId): never
{
    $user = currentSessionUser();
    $db = connectQuizDb();
    $result = @pg_query_params(
        $db,
        'DELETE FROM public.quiz q USING public."user" u
         WHERE q.id = $1 AND q.user_id = u.id AND u.auth_user_id = $2
         RETURNING q.id',
        [$quizId, $user['id']]
    );
    if ($result === false) {
        respond(500, ['error' => 'Failed to delete quiz']);
    }
    if (pg_num_rows($result) === 0) {
        respond(404, ['error' => 'Quiz not found']);
    }
    header_remove('Content-Type');
    http_response_code(204);
    exit;
}
