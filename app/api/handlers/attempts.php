<?php
declare(strict_types=1);

function quizAttemptOwner($db, int $quizId, int $authUserId, bool $lock = false): string
{
    $result = @pg_query_params($db,
        'SELECT q.user_id FROM public.quiz q JOIN public."user" u ON u.id = q.user_id
         WHERE q.id = $1 AND u.auth_user_id = $2'
         . ($lock ? ' FOR UPDATE OF q' : ''), [$quizId, $authUserId]);
    if ($result === false) respond(500, ['error' => 'Failed to load quiz']);
    $owner = pg_fetch_assoc($result);
    if ($owner === false) respond(404, ['error' => 'Quiz not found']);
    return $owner['user_id'];
}

function attemptDocument($db, array $row): array
{
    $snapshots = @pg_query_params($db,
        'SELECT s.id, b.question_id AS source_question_id, b.template, b.prompt, b.config
         FROM public.quiz_attempt_question s
         JOIN public.quiz_attempt_source b ON b.attempt_id = s.attempt_id
             AND b.question_id = s.source_question_id
         WHERE s.attempt_id = $1 ORDER BY s.position', [$row['id']]);
    if ($snapshots === false) respond(500, ['error' => 'Failed to load attempt questions']);
    $questions = [];
    while ($snapshot = pg_fetch_assoc($snapshots)) {
        $questions[] = [
            'id' => (int) $snapshot['id'], 'source_question_id' => (int) $snapshot['source_question_id'],
            'template' => $snapshot['template'], 'prompt' => $snapshot['prompt'],
            'config' => (object) json_decode($snapshot['config'], true),
        ];
    }
    $result = @pg_query_params($db,
        'SELECT question_id, answer FROM public.quiz_answer WHERE attempt_id = $1', [$row['id']]);
    if ($result === false) respond(500, ['error' => 'Failed to load answers']);
    $answers = [];
    while ($saved = pg_fetch_assoc($result)) {
        $answers[$saved['question_id']] = json_decode($saved['answer'], true);
    }
    return [
        'id' => (int) $row['id'],
        'quiz_id' => (int) $row['quiz_id'],
        'created' => $row['created'],
        'completed' => $row['completed'],
        'play_style' => $row['play_style'],
        'randomize_questions' => $row['randomize_questions'] === 't',
        'question_limit' => $row['question_limit'] === null ? null : (int) $row['question_limit'],
        'questions' => $questions,
        'answers' => (object) $answers,
    ];
}

function attemptSourceIds($db, int $attemptId): array
{
    $result = @pg_query_params($db,
        'SELECT question_id FROM public.quiz_attempt_source WHERE attempt_id = $1 ORDER BY position, question_id',
        [$attemptId]);
    if ($result === false) respond(500, ['error' => 'Failed to load attempt questions']);
    $ids = [];
    while ($row = pg_fetch_assoc($result)) $ids[] = (int) $row['question_id'];
    return $ids;
}

function chooseAttemptSource(array $ids, int $position, bool $randomize, ?int $previousId = null): int
{
    if (!$randomize) return $ids[($position - 1) % count($ids)];
    if (count($ids) === 1) return $ids[0];
    $previousIndex = $previousId === null ? false : array_search($previousId, $ids, true);
    $index = random_int(0, count($ids) - ($previousIndex === false ? 1 : 2));
    if ($previousIndex !== false && $index >= $previousIndex) $index++;
    return $ids[$index];
}

function handleStartQuizAttempt(int $quizId): never
{
    $user = currentSessionUser();
    $db = connectQuizDb();
    if (@pg_query($db, 'BEGIN') === false) respond(500, ['error' => 'Failed to start quiz']);
    if (@pg_query_params($db, 'SELECT pg_advisory_xact_lock($1)', [$user['id']]) === false) {
        respond(500, ['error' => 'Failed to start quiz']);
    }
    $ownerId = quizAttemptOwner($db, $quizId, (int) $user['id'], true);
    $result = @pg_query_params($db,
        'SELECT id, quiz_id, play_style, randomize_questions, question_limit, created, completed
         FROM public.quiz_attempt
         WHERE quiz_id = $1 AND user_id = $2 AND completed IS NULL FOR UPDATE', [$quizId, $ownerId]);
    if ($result === false) respond(500, ['error' => 'Failed to start quiz']);
    $attempt = pg_fetch_assoc($result);
    if ($attempt === false) {
        $result = @pg_query_params($db,
            'INSERT INTO public.quiz_attempt (quiz_id, user_id, play_style, randomize_questions, question_limit)
             SELECT id, user_id, play_style, randomize_questions, question_limit
             FROM public.quiz WHERE id = $1 AND user_id = $2
             RETURNING id, quiz_id, play_style, randomize_questions, question_limit, created, completed',
            [$quizId, $ownerId]);
        if ($result === false) respond(500, ['error' => 'Failed to start quiz']);
        $attempt = pg_fetch_assoc($result);
        $snapshot = @pg_query_params($db,
            'INSERT INTO public.quiz_attempt_source
                (attempt_id, question_id, position, template, prompt, config)
             SELECT $1, id, position, template, prompt, config
             FROM public.question WHERE quiz_id = $2', [$attempt['id'], $quizId]);
        if ($snapshot === false) respond(500, ['error' => 'Failed to snapshot questions']);
        if (pg_affected_rows($snapshot) === 0) respond(409, ['error' => 'Quiz has no questions']);
        $ids = attemptSourceIds($db, (int) $attempt['id']);
        $randomize = $attempt['randomize_questions'] === 't';
        if ($attempt['question_limit'] === null) {
            if ($randomize) shuffle($ids);
            $selected = $ids;
        } else {
            $count = max(1, (int) $attempt['question_limit']);
            $selected = [];
            for ($position = 1; $position <= $count; $position++) {
                $selected[] = chooseAttemptSource($ids, $position, $randomize,
                    $selected[$position - 2] ?? null);
            }
        }
        $instances = array_map(static fn (int $position, int $id): array =>
            ['position' => $position + 1, 'source_question_id' => $id], array_keys($selected), $selected);
        $created = @pg_query_params($db,
            'INSERT INTO public.quiz_attempt_question (attempt_id, source_question_id, position)
             SELECT $1, x.source_question_id, x.position
             FROM jsonb_to_recordset($2::jsonb) AS x(source_question_id bigint, position integer)',
            [$attempt['id'], json_encode($instances, JSON_THROW_ON_ERROR)]);
        if ($created === false) respond(500, ['error' => 'Failed to prepare attempt questions']);
    }
    if (@pg_query($db, 'COMMIT') === false) respond(500, ['error' => 'Failed to start quiz']);
    respond(200, attemptDocument($db, $attempt));
}

function handleListQuizAttempts(int $quizId): never
{
    $user = currentSessionUser();
    $db = connectQuizDb();
    $ownerId = quizAttemptOwner($db, $quizId, (int) $user['id']);
    $before = $_GET['before'] ?? null;
    if ($before !== null && (!is_string($before) || !preg_match('/^[1-9][0-9]*$/', $before)
        || filter_var($before, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]) === false)) {
        respond(400, ['error' => 'Invalid before cursor']);
    }
    $result = @pg_query_params($db,
        'SELECT a.id, a.quiz_id, a.play_style, a.randomize_questions, a.question_limit, a.created, a.completed,
            (SELECT COUNT(*) FROM public.quiz_attempt_question s WHERE s.attempt_id = a.id) AS question_count,
            (SELECT COUNT(*) FROM public.quiz_answer r WHERE r.attempt_id = a.id) AS answered_count
         FROM public.quiz_attempt a
         WHERE a.quiz_id = $1 AND a.user_id = $2 AND ($3::bigint IS NULL OR a.id < $3)
         ORDER BY a.id DESC LIMIT 101', [$quizId, $ownerId, $before]);
    if ($result === false) respond(500, ['error' => 'Failed to load attempts']);
    $attempts = [];
    while (count($attempts) < 100 && ($row = pg_fetch_assoc($result))) {
        $attempts[] = [
            'id' => (int) $row['id'], 'quiz_id' => (int) $row['quiz_id'],
            'created' => $row['created'], 'completed' => $row['completed'],
            'play_style' => $row['play_style'],
            'randomize_questions' => $row['randomize_questions'] === 't',
            'question_limit' => $row['question_limit'] === null ? null : (int) $row['question_limit'],
            'question_count' => (int) $row['question_count'],
            'answered_count' => (int) $row['answered_count'],
        ];
    }
    $hasMore = pg_fetch_assoc($result) !== false;
    respond(200, ['attempts' => $attempts,
        'next_before' => $hasMore ? $attempts[array_key_last($attempts)]['id'] : null]);
}

function ownedQuizAttempt($db, int $quizId, int $attemptId, int $authUserId, bool $lock = false): array
{
    $result = @pg_query_params($db,
        'SELECT a.id, a.quiz_id, a.play_style, a.randomize_questions, a.question_limit, a.created, a.completed FROM public.quiz_attempt a
         JOIN public."user" u ON u.id = a.user_id
         WHERE a.id = $1 AND a.quiz_id = $2 AND u.auth_user_id = $3'
         . ($lock ? ' FOR UPDATE OF a' : ''), [$attemptId, $quizId, $authUserId]);
    if ($result === false) respond(500, ['error' => 'Failed to load attempt']);
    $row = pg_fetch_assoc($result);
    if ($row === false) respond(404, ['error' => 'Attempt not found']);
    return $row;
}

function handleGetQuizAttempt(int $quizId, int $attemptId): never
{
    $user = currentSessionUser();
    $db = connectQuizDb();
    respond(200, attemptDocument($db, ownedQuizAttempt($db, $quizId, $attemptId, (int) $user['id'])));
}

function handleSaveQuizAnswer(int $quizId, int $attemptId, int $questionId): never
{
    $payload = readJsonBody(32768);
    $answer = $payload['answer'] ?? null;
    if (!is_array($payload) || !is_array($answer) || ($answer !== [] && array_is_list($answer))) {
        respond(400, ['error' => 'Invalid answer']);
    }
    $json = json_encode((object) $answer, JSON_THROW_ON_ERROR);
    $user = currentSessionUser();
    $db = connectQuizDb();
    if (@pg_query($db, 'BEGIN') === false) respond(500, ['error' => 'Failed to save answer']);
    $attempt = ownedQuizAttempt($db, $quizId, $attemptId, (int) $user['id'], true);
    if ($attempt['completed'] !== null) respond(409, ['error' => 'Attempt is complete']);
    $result = @pg_query_params($db,
        'INSERT INTO public.quiz_answer (attempt_id, question_id, answer)
         SELECT $1, s.id, $3::jsonb FROM public.quiz_attempt_question s
         WHERE s.id = $2 AND s.attempt_id = $1
         ON CONFLICT (attempt_id, question_id)
         DO UPDATE SET answer = EXCLUDED.answer, updated = CURRENT_TIMESTAMP
         RETURNING question_id', [$attemptId, $questionId, $json]);
    if ($result === false) respond(500, ['error' => 'Failed to save answer']);
    if (pg_num_rows($result) === 0) respond(404, ['error' => 'Question not found']);
    if (@pg_query($db, 'COMMIT') === false) respond(500, ['error' => 'Failed to save answer']);
    respond(200, ['saved' => true]);
}

function handleNextQuizQuestion(int $quizId, int $attemptId): never
{
    $payload = readJsonBody(1024);
    $after = $payload['after'] ?? null;
    if (!is_int($after) || $after < 1) respond(400, ['error' => 'Current question is required']);
    $user = currentSessionUser();
    $db = connectQuizDb();
    if (@pg_query($db, 'BEGIN') === false) respond(500, ['error' => 'Failed to load next question']);
    $attempt = ownedQuizAttempt($db, $quizId, $attemptId, (int) $user['id'], true);
    if ($attempt['completed'] !== null) respond(409, ['error' => 'Attempt is complete']);
    if ($attempt['question_limit'] !== '0') respond(409, ['error' => 'Attempt has a fixed question count']);
    $result = @pg_query_params($db,
        'SELECT position, source_question_id FROM public.quiz_attempt_question WHERE attempt_id = $1 AND id = $2',
        [$attemptId, $after]);
    if ($result === false) respond(500, ['error' => 'Failed to load next question']);
    $current = pg_fetch_assoc($result);
    if ($current === false) respond(404, ['error' => 'Question not found']);
    $position = (int) $current['position'] + 1;
    $existing = @pg_query_params($db,
        'SELECT id FROM public.quiz_attempt_question WHERE attempt_id = $1 AND position = $2',
        [$attemptId, $position]);
    if ($existing === false) respond(500, ['error' => 'Failed to load next question']);
    if (pg_num_rows($existing) === 0) {
        $ids = attemptSourceIds($db, $attemptId);
        $source = chooseAttemptSource($ids, $position, $attempt['randomize_questions'] === 't',
            (int) $current['source_question_id']);
        $created = @pg_query_params($db,
            'INSERT INTO public.quiz_attempt_question (attempt_id, source_question_id, position)
             VALUES ($1, $2, $3)', [$attemptId, $source, $position]);
        if ($created === false) respond(500, ['error' => 'Failed to load next question']);
    }
    if (@pg_query($db, 'COMMIT') === false) respond(500, ['error' => 'Failed to load next question']);
    respond(200, attemptDocument($db, $attempt));
}

function handleCompleteQuizAttempt(int $quizId, int $attemptId): never
{
    $user = currentSessionUser();
    $db = connectQuizDb();
    if (@pg_query($db, 'BEGIN') === false) respond(500, ['error' => 'Failed to finish quiz']);
    $attempt = ownedQuizAttempt($db, $quizId, $attemptId, (int) $user['id'], true);
    if ($attempt['completed'] === null) {
        $result = @pg_query_params($db,
            'UPDATE public.quiz_attempt SET completed = CURRENT_TIMESTAMP WHERE id = $1
             RETURNING id, quiz_id, play_style, randomize_questions, question_limit, created, completed', [$attemptId]);
        if ($result === false) respond(500, ['error' => 'Failed to finish quiz']);
        $attempt = pg_fetch_assoc($result);
    }
    if (@pg_query($db, 'COMMIT') === false) respond(500, ['error' => 'Failed to finish quiz']);
    respond(200, attemptDocument($db, $attempt));
}
