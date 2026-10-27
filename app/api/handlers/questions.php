<?php
declare(strict_types=1);

function publicQuestion(array $row): array
{
    return [
        'id' => (int) $row['id'],
        'quiz_id' => (int) $row['quiz_id'],
        'template' => $row['template'],
        'prompt' => $row['prompt'],
        'config' => (object) json_decode($row['config'], true),
        'created' => $row['created'],
    ];
}

function questionText(mixed $value, int $maxBytes, string $field, bool $required = true): string
{
    if (!is_string($value)) {
        respond(400, ['error' => "Invalid {$field}"]);
    }
    $text = trim($value);
    if (($required && $text === '') || strlen($text) > $maxBytes) {
        respond(400, ['error' => "Invalid {$field}"]);
    }
    return $text;
}

function questionTextList(mixed $value, int $min, int $max, int $maxBytes, string $field): array
{
    if (!is_array($value) || !array_is_list($value)
        || count($value) < $min || count($value) > $max) {
        respond(400, ['error' => "Invalid {$field} list"]);
    }
    return array_map(
        fn (mixed $item): string => questionText($item, $maxBytes, $field),
        $value
    );
}

function readQuestionFields(?array $payload): array
{
    if ($payload === null) {
        respond(400, ['error' => 'Invalid question']);
    }
    $prompt = questionText($payload['prompt'] ?? null, 500, 'question prompt');
    $template = $payload['template'] ?? null;
    $config = $payload['config'] ?? null;
    if (!is_string($template) || !in_array($template, [
        'multiple_choice', 'one_choice', 'number', 'short_answer', 'open',
        'true_false', 'yes_no', 'show_answer', 'no_answer', 'match',
        'ordering', 'fill_blanks', 'categorize',
    ], true) || !is_array($config)) {
        respond(400, ['error' => 'Invalid question template or config']);
    }

    $normalized = [];
    if ($template === 'multiple_choice' || $template === 'one_choice') {
        $options = $config['options'] ?? null;
        if (!is_array($options) || !array_is_list($options)
            || count($options) < 2 || count($options) > 8) {
            respond(400, ['error' => 'A choice question needs 2 to 8 options']);
        }
        $correctCount = 0;
        $normalized['options'] = [];
        foreach ($options as $option) {
            if (!is_array($option) || !is_bool($option['correct'] ?? null)) {
                respond(400, ['error' => 'Invalid choice option']);
            }
            $correct = $option['correct'];
            if ($correct) $correctCount++;
            $normalized['options'][] = [
                'text' => questionText($option['text'] ?? null, 150, 'choice option'),
                'correct' => $correct,
            ];
        }
        if (($template === 'one_choice' && $correctCount !== 1)
            || ($template === 'multiple_choice' && $correctCount < 1)) {
            respond(400, ['error' => 'Choose the correct answer options']);
        }
    } elseif ($template === 'number') {
        $answer = $config['answer'] ?? null;
        if (!is_string($answer) || strlen($answer) > 64
            || !preg_match('/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/', $answer)) {
            respond(400, ['error' => 'Invalid numeric answer']);
        }
        $normalized['answer'] = $answer;
    } elseif ($template === 'short_answer') {
        $normalized['answer'] = questionText($config['answer'] ?? null, 500, 'short answer');
    } elseif ($template === 'open') {
        $normalized['sample_answer'] = questionText(
            $config['sample_answer'] ?? '', 1000, 'sample answer', false
        );
    } elseif ($template === 'true_false' || $template === 'yes_no') {
        if (!is_bool($config['answer'] ?? null)) {
            respond(400, ['error' => 'Choose the correct answer']);
        }
        $normalized['answer'] = $config['answer'];
    } elseif ($template === 'show_answer') {
        $normalized['answer'] = questionText($config['answer'] ?? null, 1000, 'revealed answer');
    } elseif ($template === 'match') {
        $pairs = $config['pairs'] ?? null;
        if (!is_array($pairs) || !array_is_list($pairs)
            || count($pairs) < 2 || count($pairs) > 8) {
            respond(400, ['error' => 'A match question needs 2 to 8 pairs']);
        }
        $normalized['pairs'] = [];
        foreach ($pairs as $pair) {
            if (!is_array($pair)) {
                respond(400, ['error' => 'Invalid match pair']);
            }
            $normalized['pairs'][] = [
                'keyword' => questionText($pair['keyword'] ?? null, 150, 'match keyword'),
                'definition' => questionText($pair['definition'] ?? null, 150, 'match definition'),
            ];
        }
    } elseif ($template === 'ordering') {
        $items = questionTextList($config['items'] ?? null, 2, 8, 150, 'ordering item');
        if (count(array_unique($items)) !== count($items)) {
            respond(400, ['error' => 'Ordering items must be distinct']);
        }
        $normalized['items'] = $items;
    } elseif ($template === 'fill_blanks') {
        $answers = questionTextList($config['answers'] ?? null, 1, 8, 150, 'blank answer');
        $withoutMarkers = preg_replace('/\{\{[1-8]\}\}/', '', $prompt);
        if ($withoutMarkers === null || str_contains($withoutMarkers, '{{')
            || str_contains($withoutMarkers, '}}')
            || preg_match_all('/\{\{[1-8]\}\}/', $prompt) !== count($answers)) {
            respond(400, ['error' => 'Question blanks must match the answers']);
        }
        foreach ($answers as $index => $_) {
            if (substr_count($prompt, '{{' . ($index + 1) . '}}') !== 1) {
                respond(400, ['error' => 'Question blanks must match the answers']);
            }
        }
        $normalized['answers'] = $answers;
    } elseif ($template === 'categorize') {
        $categories = $config['categories'] ?? null;
        if (!is_array($categories) || !array_is_list($categories)
            || count($categories) < 2 || count($categories) > 8) {
            respond(400, ['error' => 'A categorization needs 2 to 8 categories']);
        }
        $normalized['categories'] = [];
        $names = [];
        $allItems = [];
        foreach ($categories as $category) {
            if (!is_array($category)) {
                respond(400, ['error' => 'Invalid category']);
            }
            $name = questionText($category['name'] ?? null, 100, 'category name');
            $items = questionTextList($category['items'] ?? null, 1, 8, 150, 'category item');
            $names[] = $name;
            array_push($allItems, ...$items);
            $normalized['categories'][] = ['name' => $name, 'items' => $items];
        }
        if (count($allItems) > 16 || count(array_unique($names)) !== count($names)
            || count(array_unique($allItems)) !== count($allItems)) {
            respond(400, ['error' => 'Categories and items must be distinct; use at most 16 items']);
        }
    }
    // No-answer questions intentionally have an empty config object.
    return [$template, $prompt, json_encode((object) $normalized, JSON_THROW_ON_ERROR)];
}

function handleListQuestions(int $quizId): never
{
    $user = currentSessionUser();
    $db = connectQuizDb();
    $owner = @pg_query_params(
        $db,
        'SELECT q.id FROM public.quiz q JOIN public."user" u ON u.id = q.user_id
         WHERE q.id = $1 AND u.auth_user_id = $2',
        [$quizId, $user['id']]
    );
    if ($owner === false) {
        respond(500, ['error' => 'Failed to load questions']);
    }
    if (pg_num_rows($owner) === 0) {
        respond(404, ['error' => 'Quiz not found']);
    }
    $result = @pg_query_params(
        $db,
        'SELECT id, quiz_id, template, prompt, config, created
         FROM public.question WHERE quiz_id = $1 ORDER BY position, id',
        [$quizId]
    );
    if ($result === false) {
        respond(500, ['error' => 'Failed to load questions']);
    }
    $questions = [];
    while ($row = pg_fetch_assoc($result)) {
        $questions[] = publicQuestion($row);
    }
    respond(200, ['questions' => $questions]);
}

function handleCreateQuestion(int $quizId): never
{
    $user = currentSessionUser();
    [$template, $prompt, $config] = readQuestionFields(readJsonBody());
    $db = connectQuizDb();
    if (@pg_query($db, 'BEGIN') === false) {
        respond(500, ['error' => 'Failed to create question']);
    }
    $owner = @pg_query_params(
        $db,
        'SELECT q.id FROM public.quiz q JOIN public."user" u ON u.id = q.user_id
         WHERE q.id = $1 AND u.auth_user_id = $2 FOR UPDATE OF q',
        [$quizId, $user['id']]
    );
    if ($owner === false) {
        @pg_query($db, 'ROLLBACK');
        respond(500, ['error' => 'Failed to create question']);
    }
    if (pg_num_rows($owner) === 0) {
        @pg_query($db, 'ROLLBACK');
        respond(404, ['error' => 'Quiz not found']);
    }
    $count = @pg_query_params($db, 'SELECT COUNT(*) FROM public.question WHERE quiz_id = $1', [$quizId]);
    if ($count === false) {
        @pg_query($db, 'ROLLBACK');
        respond(500, ['error' => 'Failed to create question']);
    }
    if ((int) pg_fetch_result($count, 0, 0) >= 100) {
        @pg_query($db, 'ROLLBACK');
        respond(409, ['error' => 'Quiz is full (100 questions)']);
    }
    $result = @pg_query_params(
        $db,
        'INSERT INTO public.question (quiz_id, template, prompt, config, position)
         VALUES ($1, $2, $3, $4::jsonb,
           (SELECT COALESCE(MAX(position), 0) + 1 FROM public.question WHERE quiz_id = $1))
         RETURNING id, quiz_id, template, prompt, config, created',
        [$quizId, $template, $prompt, $config]
    );
    if ($result === false) {
        @pg_query($db, 'ROLLBACK');
        respond(500, ['error' => 'Failed to create question']);
    }
    $question = publicQuestion(pg_fetch_assoc($result));
    if (@pg_query($db, 'COMMIT') === false) {
        respond(500, ['error' => 'Failed to create question']);
    }
    respond(201, $question);
}

function handleReorderQuestions(int $quizId): never
{
    $user = currentSessionUser();
    $payload = readJsonBody();
    $ids = $payload['question_ids'] ?? null;
    if (!is_array($ids) || !array_is_list($ids) || count($ids) > 100) {
        respond(400, ['error' => 'Invalid question order']);
    }
    foreach ($ids as $id) {
        if (!is_int($id) || $id < 1) {
            respond(400, ['error' => 'Invalid question order']);
        }
    }
    if (count(array_unique($ids)) !== count($ids)) {
        respond(400, ['error' => 'Invalid question order']);
    }

    $db = connectQuizDb();
    if (@pg_query($db, 'BEGIN') === false) {
        respond(500, ['error' => 'Failed to reorder questions']);
    }
    $owner = @pg_query_params(
        $db,
        'SELECT q.id FROM public.quiz q JOIN public."user" u ON u.id = q.user_id
         WHERE q.id = $1 AND u.auth_user_id = $2 FOR UPDATE OF q',
        [$quizId, $user['id']]
    );
    if ($owner === false) {
        @pg_query($db, 'ROLLBACK');
        respond(500, ['error' => 'Failed to reorder questions']);
    }
    if (pg_num_rows($owner) === 0) {
        @pg_query($db, 'ROLLBACK');
        respond(404, ['error' => 'Quiz not found']);
    }
    $result = @pg_query_params(
        $db,
        'SELECT id FROM public.question WHERE quiz_id = $1 FOR UPDATE',
        [$quizId]
    );
    if ($result === false) {
        @pg_query($db, 'ROLLBACK');
        respond(500, ['error' => 'Failed to reorder questions']);
    }
    $existing = array_map('intval', pg_fetch_all_columns($result, 0) ?: []);
    $requested = $ids;
    sort($existing);
    sort($requested);
    if ($requested !== $existing) {
        @pg_query($db, 'ROLLBACK');
        respond(409, ['error' => 'Question list changed; reload and try again']);
    }
    foreach ($ids as $index => $id) {
        if (@pg_query_params(
            $db,
            'UPDATE public.question SET position = $1 WHERE id = $2 AND quiz_id = $3',
            [$index + 1, $id, $quizId]
        ) === false) {
            @pg_query($db, 'ROLLBACK');
            respond(500, ['error' => 'Failed to reorder questions']);
        }
    }
    if (@pg_query($db, 'COMMIT') === false) {
        respond(500, ['error' => 'Failed to reorder questions']);
    }
    respond(200, ['question_ids' => $ids]);
}

function handleUpdateQuestion(int $quizId, int $questionId): never
{
    $user = currentSessionUser();
    [$template, $prompt, $config] = readQuestionFields(readJsonBody());
    $db = connectQuizDb();
    $result = @pg_query_params(
        $db,
        'UPDATE public.question t SET template = $1, prompt = $2, config = $3::jsonb
         FROM public.quiz q, public."user" u
         WHERE t.id = $4 AND t.quiz_id = q.id AND q.id = $5
           AND q.user_id = u.id AND u.auth_user_id = $6
         RETURNING t.id, t.quiz_id, t.template, t.prompt, t.config, t.created',
        [$template, $prompt, $config, $questionId, $quizId, $user['id']]
    );
    if ($result === false) {
        respond(500, ['error' => 'Failed to update question']);
    }
    $question = pg_fetch_assoc($result);
    if ($question === false) {
        respond(404, ['error' => 'Question not found']);
    }
    respond(200, publicQuestion($question));
}

function handleDeleteQuestion(int $quizId, int $questionId): never
{
    $user = currentSessionUser();
    $db = connectQuizDb();
    $result = @pg_query_params(
        $db,
        'DELETE FROM public.question t USING public.quiz q, public."user" u
         WHERE t.id = $1 AND t.quiz_id = q.id AND q.id = $2
           AND q.user_id = u.id AND u.auth_user_id = $3
         RETURNING t.id',
        [$questionId, $quizId, $user['id']]
    );
    if ($result === false) {
        respond(500, ['error' => 'Failed to delete question']);
    }
    if (pg_num_rows($result) === 0) {
        respond(404, ['error' => 'Question not found']);
    }
    header_remove('Content-Type');
    http_response_code(204);
    exit;
}
