<?php
declare(strict_types=1);

function publicQuiz(array $quiz): array
{
    return [
        'id' => (int) $quiz['id'],
        'name' => $quiz['name'],
        'created' => $quiz['created'],
    ];
}

function handleListQuizzes(): never
{
    $user = currentSessionUser();
    $db = connectQuizDb();
    $result = @pg_query_params(
        $db,
        'SELECT q.id, q.name, q.created
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

function handleCreateQuiz(): never
{
    $user = currentSessionUser();
    $payload = readJsonBody();
    if ($payload === null || !is_string($payload['name'] ?? null)) {
        respond(400, ['error' => 'Quiz name is required']);
    }
    $name = trim($payload['name']);
    if ($name === '' || strlen($name) > 100) {
        respond(400, ['error' => 'Quiz name must be between 1 and 100 bytes']);
    }

    $db = connectQuizDb();
    if (@pg_query($db, 'BEGIN') === false) {
        respond(500, ['error' => 'Failed to create quiz']);
    }
    $lock = @pg_query_params($db, 'SELECT pg_advisory_xact_lock($1)', [$user['id']]);
    $owner = $lock === false ? false : @pg_query_params(
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
        respond(500, ['error' => 'Failed to create quiz']);
    }
    $count = @pg_query_params(
        $db,
        'SELECT COUNT(*) AS total FROM public.quiz WHERE user_id = $1',
        [$localUserId]
    );
    if ($count === false) {
        @pg_query($db, 'ROLLBACK');
        respond(500, ['error' => 'Failed to create quiz']);
    }
    if ((int) pg_fetch_result($count, 0, 'total') >= 100) {
        @pg_query($db, 'ROLLBACK');
        respond(409, ['error' => 'Library is full (100 quizzes)']);
    }
    $result = @pg_query_params(
        $db,
        'INSERT INTO public.quiz (user_id, name) VALUES ($1, $2) RETURNING id, name, created',
        [$localUserId, $name]
    );
    if ($result === false) {
        @pg_query($db, 'ROLLBACK');
        respond(500, ['error' => 'Failed to create quiz']);
    }
    $quiz = publicQuiz(pg_fetch_assoc($result));
    if (@pg_query($db, 'COMMIT') === false) {
        respond(500, ['error' => 'Failed to create quiz']);
    }
    respond(201, $quiz);
}

function handleUpdateQuiz(int $quizId): never
{
    $user = currentSessionUser();
    $payload = readJsonBody();
    if ($payload === null || !is_string($payload['name'] ?? null)) {
        respond(400, ['error' => 'Quiz name is required']);
    }
    $name = trim($payload['name']);
    if ($name === '' || strlen($name) > 100) {
        respond(400, ['error' => 'Quiz name must be between 1 and 100 bytes']);
    }

    $db = connectQuizDb();
    $result = @pg_query_params(
        $db,
        'UPDATE public.quiz q SET name = $1 FROM public."user" u
         WHERE q.id = $2 AND q.user_id = u.id AND u.auth_user_id = $3
         RETURNING q.id, q.name, q.created',
        [$name, $quizId, $user['id']]
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
