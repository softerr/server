<?php
declare(strict_types=1);

function publicQuiz(array $quiz): array
{
    return [
        'id' => (int) $quiz['id'],
        'name' => $quiz['name'],
        'description' => $quiz['description'],
        'created' => $quiz['created'],
    ];
}

function handleListQuizzes(): never
{
    $user = currentSessionUser();
    $db = connectQuizDb();
    $result = @pg_query_params(
        $db,
        'SELECT q.id, q.name, q.description, q.created
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
        'SELECT q.id, q.name, q.description, q.created
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
    return [$name, $description === null ? null : trim($description)];
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

function insertQuizRow($db, string $localUserId, string $name, string $description, string $error): array
{
    $result = @pg_query_params(
        $db,
        'INSERT INTO public.quiz (user_id, name, description)
         VALUES ($1, $2, $3)
         RETURNING id, name, description, created',
        [$localUserId, $name, $description]
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
    [$name, $description] = readQuizFields(readJsonBody());
    $db = connectQuizDb();
    $error = 'Failed to create quiz';
    $localUserId = beginQuizCreation($db, $user, $error);
    $quiz = insertQuizRow($db, $localUserId, $name, $description, $error);
    if (@pg_query($db, 'COMMIT') === false) {
        respond(500, ['error' => $error]);
    }
    respond(201, $quiz);
}

function handleImportQuiz(): never
{
    $user = currentSessionUser();
    $payload = readJsonBody(524288);
    if ($payload === null || ($payload['format'] ?? null) !== 'softerr-quiz'
        || ($payload['version'] ?? null) !== 1
        || !is_string($payload['description'] ?? null)
        || !is_array($payload['questions'] ?? null)
        || !array_is_list($payload['questions'])
        || count($payload['questions']) > 100) {
        respond(400, ['error' => 'Invalid quiz export']);
    }
    [$name, $description] = readQuizFields($payload);
    $questions = [];
    foreach ($payload['questions'] as $question) {
        if (!is_array($question)) {
            respond(400, ['error' => 'Invalid quiz question']);
        }
        $questions[] = readQuestionFields($question);
    }

    $db = connectQuizDb();
    $error = 'Failed to import quiz';
    $localUserId = beginQuizCreation($db, $user, $error);
    $quiz = insertQuizRow($db, $localUserId, $name, $description, $error);
    foreach ($questions as $position => [$template, $prompt, $config]) {
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
    if (@pg_query($db, 'COMMIT') === false) {
        respond(500, ['error' => $error]);
    }
    respond(201, $quiz);
}

function handleUpdateQuiz(int $quizId): never
{
    $user = currentSessionUser();
    [$name, $description] = readQuizFields(readJsonBody(), true);

    $db = connectQuizDb();
    $result = @pg_query_params(
        $db,
        'UPDATE public.quiz q SET name = $1,
            description = COALESCE($2, q.description)
         FROM public."user" u
         WHERE q.id = $3 AND q.user_id = u.id AND u.auth_user_id = $4
         RETURNING q.id, q.name, q.description, q.created',
        [$name, $description, $quizId, $user['id']]
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
