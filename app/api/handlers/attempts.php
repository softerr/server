<?php
declare(strict_types=1);

function quizPlayerAccess($db, int $quizId, int $authUserId, bool $lock = false, bool $includeHistory = false): array
{
    $result = @pg_query_params($db,
        'SELECT q.user_id AS owner_id, q.is_public, owner.auth_user_id AS owner_auth_user_id,
            player.id AS player_id
         FROM public.quiz q
         JOIN public."user" owner ON owner.id = q.user_id
         LEFT JOIN public."user" player ON player.auth_user_id = $2
         WHERE q.id = $1 AND (q.is_public = TRUE OR owner.auth_user_id = $2
            OR EXISTS (SELECT 1 FROM public.quiz_attempt a WHERE a.quiz_id = q.id
                AND a.user_id = player.id AND ($3::boolean OR a.completed IS NULL)))'
         . ($lock ? ' FOR UPDATE OF q' : ''), [$quizId, $authUserId, $includeHistory ? 't' : 'f']);
    if ($result === false) respond(500, ['error' => 'Failed to load quiz']);
    $access = pg_fetch_assoc($result);
    if ($access === false) respond(404, ['error' => 'Quiz not found']);
    return $access;
}

function attemptDocument($db, array $row): array
{
    $settings = @pg_query_params($db,
        'SELECT q.show_correct_answers FROM public.quiz q WHERE q.id = $1', [$row['quiz_id']]);
    if ($settings === false) respond(500, ['error' => 'Failed to load quiz settings']);
    $showSolutions = $row['completed'] !== null && pg_fetch_result($settings, 0, 0) === 't';
    $snapshots = @pg_query_params($db,
        'SELECT s.id, b.question_id AS source_question_id, b.template, b.prompt, b.config,
            b.time_limit_seconds, s.started_at,
            CASE WHEN s.started_at IS NULL OR b.time_limit_seconds IS NULL THEN NULL
                ELSE EXTRACT(EPOCH FROM (s.started_at + b.time_limit_seconds * INTERVAL \'1 second\')) * 1000 END AS deadline_ms
         FROM public.quiz_attempt_question s
         JOIN public.quiz_attempt_source b ON b.attempt_id = s.attempt_id
             AND b.question_id = s.source_question_id
         WHERE s.attempt_id = $1 ORDER BY s.position', [$row['id']]);
    if ($snapshots === false) respond(500, ['error' => 'Failed to load attempt questions']);
    $questions = [];
    $allQuestions = [];
    while ($snapshot = pg_fetch_assoc($snapshots)) {
        $allQuestions[] = $snapshot;
    }
    $visibleCount = $row['completed'] !== null ? count($allQuestions)
        : min(count($allQuestions), max(1, (int) $row['furthest_position']));
    foreach (array_slice($allQuestions, 0, $visibleCount) as $snapshot) {
        $config = json_decode($snapshot['config'], true);
        $question = [
            'id' => (int) $snapshot['id'], 'source_question_id' => (int) $snapshot['source_question_id'],
            'template' => $snapshot['template'], 'prompt' => $snapshot['prompt'],
            'config' => (object) playQuestionConfig($snapshot['template'], $config, (int) $snapshot['id'], false),
            'time_limit_seconds' => $snapshot['time_limit_seconds'] === null ? null : (int) $snapshot['time_limit_seconds'],
            'started' => $snapshot['started_at'] !== null,
            'deadline_ms' => $snapshot['deadline_ms'] === null ? null : (int) $snapshot['deadline_ms'],
        ];
        if ($showSolutions) {
            if ($snapshot['template'] === 'match') {
                $config['_display_order'] = presentationOrder(count($config['pairs']), (int) $snapshot['id'], 'match');
            } elseif ($snapshot['template'] === 'ordering') {
                $config['_display_order'] = presentationOrder(count($config['items']), (int) $snapshot['id'], 'ordering');
            } elseif ($snapshot['template'] === 'categorize') {
                $itemCount = array_sum(array_map(static fn (array $category): int => count($category['items']), $config['categories']));
                $config['_display_order'] = presentationOrder($itemCount, (int) $snapshot['id'], 'categorize');
            } elseif ($snapshot['template'] === 'fill_blanks') {
                $imageAnswerIndices = [];
                foreach ($config['answers'] as $answerIndex => $answer) {
                    if (($answer['text'] ?? '') === '') $imageAnswerIndices[] = $answerIndex;
                }
                $config['_image_answer_indices'] = $imageAnswerIndices;
                $config['_display_order'] = presentationOrder(count($imageAnswerIndices), (int) $snapshot['id'], 'blanks');
            }
            $question['solution'] = (object) $config;
        }
        $questions[] = $question;
    }
    $result = @pg_query_params($db,
        'SELECT question_id, answer FROM public.quiz_answer WHERE attempt_id = $1', [$row['id']]);
    if ($result === false) respond(500, ['error' => 'Failed to load answers']);
    $answers = [];
    while ($saved = pg_fetch_assoc($result)) {
        $answers[$saved['question_id']] = json_decode($saved['answer'], true);
    }
    foreach ($questions as $index => &$question) {
        if ($question['template'] === 'show_answer' && ($answers[$question['id']]['revealed'] ?? false) === true) {
            $original = json_decode($allQuestions[$index]['config'], true);
            $question['config']->answer = $original['answer'];
            if (isset($original['answer_image_id'])) $question['config']->answer_image_id = $original['answer_image_id'];
        }
    }
    unset($question);
    $score = null;
    if ($row['completed'] !== null) {
        $score = ['graded' => 0, 'correct' => 0, 'ungraded' => 0];
        foreach ($allQuestions as $index => $snapshot) {
            $saved = $answers[$snapshot['id']] ?? null;
            $grade = gradeAttemptAnswer($snapshot['template'], json_decode($snapshot['config'], true),
                is_array($saved) ? $saved : null, (int) $snapshot['id']);
            if ($grade === null) $score['ungraded']++;
            else {
                $score['graded']++;
                if ($grade) $score['correct']++;
            }
            if ($showSolutions) $questions[$index]['correct'] = $grade;
        }
    }
    return [
        'id' => (int) $row['id'],
        'quiz_id' => (int) $row['quiz_id'],
        'created' => $row['created'],
        'completed' => $row['completed'],
        'play_style' => $row['play_style'],
        'randomize_questions' => $row['randomize_questions'] === 't',
        'allow_go_back' => $row['allow_go_back'] === 't',
        'furthest_position' => (int) $row['furthest_position'],
        'question_limit' => $row['question_limit'] === null ? null : (int) $row['question_limit'],
        'time_limit_seconds' => $row['time_limit_seconds'] === null ? null : (int) $row['time_limit_seconds'],
        'deadline_ms' => $row['deadline_at'] === null ? null
            : (int) round((float) (new DateTimeImmutable($row['deadline_at']))->format('U.u') * 1000),
        'server_time_ms' => (int) round(microtime(true) * 1000),
        'questions' => $questions,
        'question_count' => count($allQuestions),
        'score' => $score,
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

function expireQuizAttempt($db, array $attempt): array
{
    if ($attempt['completed'] !== null || $attempt['deadline_at'] === null) return $attempt;
    $result = @pg_query_params($db,
        'UPDATE public.quiz_attempt SET completed = clock_timestamp()
         WHERE id = $1 AND completed IS NULL AND deadline_at <= clock_timestamp()
         RETURNING completed', [$attempt['id']]);
    if ($result === false) respond(500, ['error' => 'Failed to check quiz timer']);
    $expired = pg_fetch_assoc($result);
    if ($expired !== false) $attempt['completed'] = $expired['completed'];
    return $attempt;
}

function openFirstAttemptQuestion($db, array &$attempt): void
{
    if ($attempt['completed'] !== null || (int) $attempt['furthest_position'] !== 0) return;
    $opened = @pg_query_params($db,
        'UPDATE public.quiz_attempt_question SET started_at = COALESCE(started_at, clock_timestamp())
         WHERE attempt_id = $1 AND position = 1', [$attempt['id']]);
    if ($opened === false) respond(500, ['error' => 'Failed to start first question']);
    $progress = @pg_query_params($db,
        'UPDATE public.quiz_attempt SET furthest_position = 1 WHERE id = $1 RETURNING furthest_position',
        [$attempt['id']]);
    if ($progress === false) respond(500, ['error' => 'Failed to start first question']);
    $attempt['furthest_position'] = '1';
}

function handleStartQuizAttempt(int $quizId): never
{
    $user = currentSessionUser();
    $db = connectQuizDb();
    if (@pg_query($db, 'BEGIN') === false) respond(500, ['error' => 'Failed to start quiz']);
    if (@pg_query_params($db, 'SELECT pg_advisory_xact_lock($1)', [$user['id']]) === false) {
        respond(500, ['error' => 'Failed to start quiz']);
    }
    $access = quizPlayerAccess($db, $quizId, (int) $user['id'], true);
    $playerId = $access['player_id'];
    if ($playerId === null) {
        $createdPlayer = @pg_query_params($db,
            'INSERT INTO public."user" (auth_user_id) VALUES ($1) ON CONFLICT (auth_user_id) DO NOTHING',
            [$user['id']]);
        $player = $createdPlayer === false ? false : @pg_query_params($db,
            'SELECT id FROM public."user" WHERE auth_user_id = $1', [$user['id']]);
        if ($player === false || ($playerId = pg_fetch_result($player, 0, 0)) === false) {
            respond(500, ['error' => 'Failed to start quiz']);
        }
    }
    $result = @pg_query_params($db,
        'SELECT id, quiz_id, play_style, allow_go_back, furthest_position, randomize_questions, question_limit, time_limit_seconds, deadline_at, created, completed
         FROM public.quiz_attempt
         WHERE quiz_id = $1 AND user_id = $2 AND completed IS NULL FOR UPDATE', [$quizId, $playerId]);
    if ($result === false) respond(500, ['error' => 'Failed to start quiz']);
    $attempt = pg_fetch_assoc($result);
    if ($attempt !== false) $attempt = expireQuizAttempt($db, $attempt);
    if ($attempt !== false && $attempt['completed'] !== null) {
        if (@pg_query($db, 'COMMIT') === false) respond(500, ['error' => 'Failed to start quiz']);
        respond(200, attemptDocument($db, $attempt));
    }
    if ($attempt === false) {
        if ($access['is_public'] !== 't' && (int) $access['owner_auth_user_id'] !== (int) $user['id']) {
            respond(404, ['error' => 'Quiz not found']);
        }
        $result = @pg_query_params($db,
            'INSERT INTO public.quiz_attempt (quiz_id, user_id, play_style, allow_go_back, randomize_questions, question_limit, time_limit_seconds, deadline_at)
             SELECT id, $2::bigint, play_style, allow_go_back, randomize_questions, question_limit, time_limit_seconds,
                CASE WHEN time_limit_seconds IS NULL THEN NULL ELSE clock_timestamp() + time_limit_seconds * INTERVAL \'1 second\' END
             FROM public.quiz WHERE id = $1
             RETURNING id, quiz_id, play_style, allow_go_back, furthest_position, randomize_questions, question_limit, time_limit_seconds, deadline_at, created, completed',
            [$quizId, $playerId]);
        if ($result === false) respond(500, ['error' => 'Failed to start quiz']);
        $attempt = pg_fetch_assoc($result);
        $snapshot = @pg_query_params($db,
            'INSERT INTO public.quiz_attempt_source
                (attempt_id, question_id, position, template, prompt, config, time_limit_seconds)
             SELECT $1, id, position, template, prompt, config, time_limit_seconds
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
    openFirstAttemptQuestion($db, $attempt);
    if (@pg_query($db, 'COMMIT') === false) respond(500, ['error' => 'Failed to start quiz']);
    respond(200, attemptDocument($db, $attempt));
}

function handleListQuizAttempts(int $quizId): never
{
    $user = currentSessionUser();
    $db = connectQuizDb();
    $access = quizPlayerAccess($db, $quizId, (int) $user['id'], false, true);
    $playerId = $access['player_id'];
    if ($playerId === null) respond(200, ['attempts' => [], 'next_before' => null]);
    $expired = @pg_query_params($db,
        'UPDATE public.quiz_attempt SET completed = clock_timestamp()
         WHERE quiz_id = $1 AND user_id = $2 AND completed IS NULL AND deadline_at <= clock_timestamp()',
        [$quizId, $playerId]);
    if ($expired === false) respond(500, ['error' => 'Failed to load attempts']);
    $before = $_GET['before'] ?? null;
    if ($before !== null && (!is_string($before) || !preg_match('/^[1-9][0-9]*$/', $before)
        || filter_var($before, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]) === false)) {
        respond(400, ['error' => 'Invalid before cursor']);
    }
    $result = @pg_query_params($db,
        'SELECT a.id, a.quiz_id, a.play_style, a.allow_go_back, a.randomize_questions, a.question_limit, a.created, a.completed,
            (SELECT COUNT(*) FROM public.quiz_attempt_question s WHERE s.attempt_id = a.id) AS question_count,
            (SELECT COUNT(*) FROM public.quiz_answer r WHERE r.attempt_id = a.id) AS answered_count
         FROM public.quiz_attempt a
         WHERE a.quiz_id = $1 AND a.user_id = $2 AND ($3::bigint IS NULL OR a.id < $3)
         ORDER BY a.id DESC LIMIT 101', [$quizId, $playerId, $before]);
    if ($result === false) respond(500, ['error' => 'Failed to load attempts']);
    $attempts = [];
    while (count($attempts) < 100 && ($row = pg_fetch_assoc($result))) {
        $attempts[] = [
            'id' => (int) $row['id'], 'quiz_id' => (int) $row['quiz_id'],
            'created' => $row['created'], 'completed' => $row['completed'],
            'play_style' => $row['play_style'],
            'randomize_questions' => $row['randomize_questions'] === 't',
            'allow_go_back' => $row['allow_go_back'] === 't',
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
        'SELECT a.id, a.quiz_id, a.play_style, a.allow_go_back, a.furthest_position, a.randomize_questions, a.question_limit,
            a.time_limit_seconds, a.deadline_at, a.created, a.completed FROM public.quiz_attempt a
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
    $attempt = ownedQuizAttempt($db, $quizId, $attemptId, (int) $user['id']);
    if ($attempt['completed'] === null && (int) $attempt['furthest_position'] === 0) {
        if (@pg_query($db, 'BEGIN') === false) respond(500, ['error' => 'Failed to load attempt']);
        $attempt = ownedQuizAttempt($db, $quizId, $attemptId, (int) $user['id'], true);
        openFirstAttemptQuestion($db, $attempt);
        if (@pg_query($db, 'COMMIT') === false) respond(500, ['error' => 'Failed to load attempt']);
    }
    if ($attempt['completed'] === null && $attempt['deadline_at'] !== null) {
        $attempt = expireQuizAttempt($db, $attempt);
    }
    respond(200, attemptDocument($db, $attempt));
}

function handleStartAttemptQuestion(int $quizId, int $attemptId, int $questionId): never
{
    $user = currentSessionUser();
    $db = connectQuizDb();
    if (@pg_query($db, 'BEGIN') === false) respond(500, ['error' => 'Failed to start question']);
    $attempt = expireQuizAttempt($db, ownedQuizAttempt($db, $quizId, $attemptId, (int) $user['id'], true));
    if ($attempt['completed'] !== null) respond(409, ['error' => 'Attempt is complete']);
    $positionResult = @pg_query_params($db,
        'SELECT position FROM public.quiz_attempt_question WHERE id = $1 AND attempt_id = $2',
        [$questionId, $attemptId]);
    if ($positionResult === false) respond(500, ['error' => 'Failed to start question']);
    $positionRow = pg_fetch_assoc($positionResult);
    if ($positionRow === false) respond(404, ['error' => 'Question not found']);
    $questionPosition = (int) $positionRow['position'];
    if ($questionPosition > max(1, (int) $attempt['furthest_position'])) {
        respond(404, ['error' => 'Question not found']);
    }
    if ($attempt['allow_go_back'] === 'f' && $questionPosition < (int) $attempt['furthest_position']) {
        respond(409, ['error' => 'Going back is disabled']);
    }
    $progress = @pg_query_params($db,
        'UPDATE public.quiz_attempt SET furthest_position = GREATEST(furthest_position, $2)
         WHERE id = $1 RETURNING furthest_position', [$attemptId, $questionPosition]);
    if ($progress === false) respond(500, ['error' => 'Failed to start question']);
    $attempt['furthest_position'] = pg_fetch_result($progress, 0, 0);
    $result = @pg_query_params($db,
        'UPDATE public.quiz_attempt_question s SET started_at = COALESCE(s.started_at, clock_timestamp())
         WHERE s.id = $1 AND s.attempt_id = $2
         RETURNING s.id', [$questionId, $attemptId]);
    if ($result === false) respond(500, ['error' => 'Failed to start question']);
    if (pg_num_rows($result) === 0) respond(404, ['error' => 'Question not found']);
    if (@pg_query($db, 'COMMIT') === false) respond(500, ['error' => 'Failed to start question']);
    respond(200, attemptDocument($db, $attempt));
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
    $attempt = expireQuizAttempt($db, $attempt);
    if ($attempt['completed'] !== null) respond(409, ['error' => 'Attempt is complete']);
    openFirstAttemptQuestion($db, $attempt);
    $timing = @pg_query_params($db,
        'SELECT b.time_limit_seconds, s.started_at, s.position,
            s.started_at + b.time_limit_seconds * INTERVAL \'1 second\' <= clock_timestamp() AS expired
         FROM public.quiz_attempt_question s
         JOIN public.quiz_attempt_source b ON b.attempt_id = s.attempt_id AND b.question_id = s.source_question_id
         WHERE s.id = $1 AND s.attempt_id = $2', [$questionId, $attemptId]);
    if ($timing === false) respond(500, ['error' => 'Failed to check question timer']);
    $clock = pg_fetch_assoc($timing);
    if ($clock === false) respond(404, ['error' => 'Question not found']);
    if ((int) $clock['position'] > max(1, (int) $attempt['furthest_position'])) {
        respond(404, ['error' => 'Question not found']);
    }
    if ($attempt['allow_go_back'] === 'f' && (int) $clock['position'] !== (int) $attempt['furthest_position']) {
        respond(409, ['error' => 'Going back is disabled']);
    }
    if ($clock['time_limit_seconds'] !== null && ($clock['started_at'] === null || $clock['expired'] === 't')) {
        respond(409, ['error' => 'Question time is up']);
    }
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

function handleRevealQuizAnswer(int $quizId, int $attemptId, int $questionId): never
{
    $user = currentSessionUser();
    $db = connectQuizDb();
    if (@pg_query($db, 'BEGIN') === false) respond(500, ['error' => 'Failed to reveal answer']);
    $attempt = expireQuizAttempt($db, ownedQuizAttempt($db, $quizId, $attemptId, (int) $user['id'], true));
    if ($attempt['completed'] !== null) respond(409, ['error' => 'Attempt is complete']);
    $result = @pg_query_params($db,
        'SELECT s.position, s.started_at, b.config, b.time_limit_seconds,
            s.started_at + b.time_limit_seconds * INTERVAL \'1 second\' <= clock_timestamp() AS expired
         FROM public.quiz_attempt_question s
         JOIN public.quiz_attempt_source b ON b.attempt_id = s.attempt_id AND b.question_id = s.source_question_id
         WHERE s.attempt_id = $1 AND s.id = $2 AND b.template = \'show_answer\'', [$attemptId, $questionId]);
    if ($result === false) respond(500, ['error' => 'Failed to reveal answer']);
    $row = pg_fetch_assoc($result);
    if ($row === false || (int) $row['position'] > max(1, (int) $attempt['furthest_position'])) {
        respond(404, ['error' => 'Question not found']);
    }
    if ($attempt['allow_go_back'] === 'f' && (int) $row['position'] !== (int) $attempt['furthest_position']) {
        respond(409, ['error' => 'Going back is disabled']);
    }
    if ($row['time_limit_seconds'] !== null && ($row['started_at'] === null || $row['expired'] === 't')) {
        respond(409, ['error' => 'Question time is up']);
    }
    $saved = @pg_query_params($db,
        'INSERT INTO public.quiz_answer (attempt_id, question_id, answer) VALUES ($1, $2, \'{"revealed":true}\'::jsonb)
         ON CONFLICT (attempt_id, question_id) DO UPDATE SET answer = EXCLUDED.answer, updated = CURRENT_TIMESTAMP',
        [$attemptId, $questionId]);
    if ($saved === false) respond(500, ['error' => 'Failed to reveal answer']);
    if (@pg_query($db, 'COMMIT') === false) respond(500, ['error' => 'Failed to reveal answer']);
    $config = json_decode($row['config'], true);
    respond(200, ['answer' => $config['answer'], 'answer_image_id' => $config['answer_image_id'] ?? null]);
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
    $attempt = expireQuizAttempt($db, $attempt);
    if ($attempt['completed'] !== null) respond(409, ['error' => 'Attempt is complete']);
    openFirstAttemptQuestion($db, $attempt);
    $result = @pg_query_params($db,
        'SELECT position, source_question_id FROM public.quiz_attempt_question WHERE attempt_id = $1 AND id = $2',
        [$attemptId, $after]);
    if ($result === false) respond(500, ['error' => 'Failed to load next question']);
    $current = pg_fetch_assoc($result);
    if ($current === false) respond(404, ['error' => 'Question not found']);
    $furthest = max(1, (int) $attempt['furthest_position']);
    if ((int) $current['position'] === $furthest - 1) {
        if (@pg_query($db, 'COMMIT') === false) respond(500, ['error' => 'Failed to load next question']);
        respond(200, attemptDocument($db, $attempt));
    }
    if ((int) $current['position'] !== $furthest) {
        respond(409, ['error' => 'Current question is required']);
    }
    if ($attempt['allow_go_back'] === 'f' && (int) $current['position'] !== (int) $attempt['furthest_position']) {
        respond(409, ['error' => 'Going back is disabled']);
    }
    $position = (int) $current['position'] + 1;
    $existing = @pg_query_params($db,
        'SELECT id FROM public.quiz_attempt_question WHERE attempt_id = $1 AND position = $2',
        [$attemptId, $position]);
    if ($existing === false) respond(500, ['error' => 'Failed to load next question']);
    if (pg_num_rows($existing) === 0) {
        if ($attempt['question_limit'] !== '0') respond(409, ['error' => 'No more questions']);
        $ids = attemptSourceIds($db, $attemptId);
        $source = chooseAttemptSource($ids, $position, $attempt['randomize_questions'] === 't',
            (int) $current['source_question_id']);
        $created = @pg_query_params($db,
            'INSERT INTO public.quiz_attempt_question (attempt_id, source_question_id, position)
             VALUES ($1, $2, $3)', [$attemptId, $source, $position]);
        if ($created === false) respond(500, ['error' => 'Failed to load next question']);
    }
    $progress = @pg_query_params($db,
        'UPDATE public.quiz_attempt SET furthest_position = $2 WHERE id = $1 RETURNING furthest_position',
        [$attemptId, $position]);
    if ($progress === false) respond(500, ['error' => 'Failed to load next question']);
    $attempt['furthest_position'] = pg_fetch_result($progress, 0, 0);
    $opened = @pg_query_params($db,
        'UPDATE public.quiz_attempt_question SET started_at = COALESCE(started_at, clock_timestamp())
         WHERE attempt_id = $1 AND position = $2', [$attemptId, $position]);
    if ($opened === false) respond(500, ['error' => 'Failed to start next question']);
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
             RETURNING id, quiz_id, play_style, allow_go_back, furthest_position, randomize_questions, question_limit, time_limit_seconds, deadline_at, created, completed', [$attemptId]);
        if ($result === false) respond(500, ['error' => 'Failed to finish quiz']);
        $attempt = pg_fetch_assoc($result);
    }
    if (@pg_query($db, 'COMMIT') === false) respond(500, ['error' => 'Failed to finish quiz']);
    respond(200, attemptDocument($db, $attempt));
}
