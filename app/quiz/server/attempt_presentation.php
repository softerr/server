<?php
declare(strict_types=1);

// A stable, server-only permutation keeps a resumed question in the same order.
function presentationOrder(int $count, int $questionId, string $purpose): array
{
    $order = $count > 0 ? range(0, $count - 1) : [];
    if ($count < 2) return $order;
    $key = getenv('DB_PASSWORD') ?: 'quiz-presentation';
    usort($order, static fn (int $a, int $b): int => strcmp(
        hash_hmac('sha256', "$questionId:$purpose:$a", $key),
        hash_hmac('sha256', "$questionId:$purpose:$b", $key)
    ));
    return $order;
}

function playQuestionConfig(string $template, array $config, int $questionId, bool $showSolution, bool $randomizeAnswers = false): array
{
    if ($showSolution) return $config;
    unset($config['answer_image_id']);
    if (in_array($template, ['multiple_choice', 'one_choice'], true)) {
        foreach ($config['options'] as &$option) unset($option['correct']);
        unset($option);
        if ($randomizeAnswers) {
            $options = $config['options'];
            $config['options'] = array_map(static fn (int $index): array => $options[$index],
                presentationOrder(count($options), $questionId, 'choices'));
        }
    } elseif (in_array($template, ['number', 'short_answer', 'true_false', 'yes_no', 'show_answer'], true)) {
        unset($config['answer']);
    } elseif ($template === 'open') {
        unset($config['sample_answer']);
    } elseif ($template === 'match') {
        $pairs = $config['pairs'];
        $order = presentationOrder(count($pairs), $questionId, 'match');
        $config['pairs'] = array_map(static fn (array $pair): array => array_intersect_key($pair,
            array_flip(['keyword', 'keyword_image_id'])), $randomizeAnswers
                ? array_map(static fn (int $index): array => $pairs[$index],
                    presentationOrder(count($pairs), $questionId, 'match-keywords'))
                : $pairs);
        $config['definitions'] = array_map(static fn (int $index): array =>
            array_intersect_key($pairs[$index], array_flip(['definition', 'definition_image_id'])), $order);
    } elseif ($template === 'ordering') {
        $items = $config['items'];
        $config['items'] = array_map(static fn (int $index): array => $items[$index],
            presentationOrder(count($items), $questionId, 'ordering'));
        $config['_ordered_for_play'] = true;
    } elseif ($template === 'fill_blanks') {
        $imageChoices = [];
        foreach ($config['answers'] as $index => $answer) {
            if (($answer['text'] ?? '') === '' && isset($answer['image_id'])) {
                $imageChoices[] = ['answer_index' => $index, 'image_id' => $answer['image_id']];
            }
        }
        $config['image_choices'] = array_map(static fn (int $index): array =>
            ['image_id' => $imageChoices[$index]['image_id']],
            presentationOrder(count($imageChoices), $questionId, 'blanks'));
        $config['answers'] = array_map(static fn (array $answer): array => [
            'text' => ($answer['text'] ?? '') === '' ? '' : 'text',
        ], $config['answers']);
    } elseif ($template === 'categorize') {
        $items = [];
        foreach ($config['categories'] as $category) {
            foreach ($category['items'] as $item) $items[] = $item;
        }
        $config['categories'] = array_map(static fn (array $category): array =>
            array_intersect_key($category, array_flip(['name', 'name_image_id'])), $randomizeAnswers
                ? array_map(static fn (int $index): array => $config['categories'][$index],
                    presentationOrder(count($config['categories']), $questionId, 'category-labels'))
                : $config['categories']);
        $config['items'] = array_map(static fn (int $index): array => $items[$index],
            presentationOrder(count($items), $questionId, 'categorize'));
    }
    return $config;
}

function normalizedAttemptText(string $value): string
{
    $normalized = preg_replace('/\s+/u', ' ', trim($value)) ?? trim($value);
    return function_exists('mb_strtolower') ? mb_strtolower($normalized, 'UTF-8') : strtolower($normalized);
}

function gradeAttemptAnswer(string $template, array $config, ?array $answer, int $questionId, bool $randomizeAnswers = false): ?bool
{
    if (in_array($template, ['open', 'show_answer', 'no_answer'], true)) return null;
    if ($answer === null) return false;
    if ($template === 'multiple_choice' || $template === 'one_choice') {
        $selected = $answer['selected'] ?? null;
        if (!is_array($selected)) return false;
        $order = $randomizeAnswers
            ? presentationOrder(count($config['options']), $questionId, 'choices')
            : array_keys($config['options']);
        foreach ($order as $index => $sourceIndex) {
            $option = $config['options'][$sourceIndex];
            if (in_array($index, $selected, true) !== $option['correct']) return false;
        }
        return true;
    }
    if ($template === 'true_false' || $template === 'yes_no') {
        return ($answer['selected'] ?? null) === ($config['answer'] ? 'true' : 'false');
    }
    if ($template === 'number') {
        $value = $answer['text'] ?? null;
        return is_string($value) && trim($value) !== '' && is_numeric(trim($value))
            && (float) trim($value) === (float) $config['answer'];
    }
    if ($template === 'short_answer') {
        $value = $answer['text'] ?? null;
        return is_string($value) && trim($value) !== ''
            && normalizedAttemptText($value) === normalizedAttemptText($config['answer']);
    }
    if ($template === 'match') {
        $values = $answer['assignments'] ?? null;
        $order = presentationOrder(count($config['pairs']), $questionId, 'match');
        $keywordOrder = $randomizeAnswers
            ? presentationOrder(count($config['pairs']), $questionId, 'match-keywords')
            : array_keys($config['pairs']);
        return is_array($values) && count($values) === count($order)
            && array_reduce(array_keys($order), static fn (bool $okay, int $target): bool =>
                $okay && (string) ($values[$target] ?? '') === (string) array_search($keywordOrder[$target], $order, true), true);
    }
    if ($template === 'ordering') {
        $values = $answer['order'] ?? null;
        $order = presentationOrder(count($config['items']), $questionId, 'ordering');
        return is_array($values) && count($values) === count($order)
            && array_map(static fn ($value) => is_int($value) && isset($order[$value]) ? $order[$value] : -1, $values)
                === range(0, count($order) - 1);
    }
    if ($template === 'fill_blanks') {
        $values = $answer['values'] ?? null;
        if (!is_array($values) || count($values) !== count($config['answers'])) return false;
        foreach ($config['answers'] as $index => $expected) {
            $value = $values[$index] ?? null;
            if (!is_string($value)) return false;
            if (($expected['text'] ?? '') !== '') {
                if (normalizedAttemptText($value) !== normalizedAttemptText($expected['text'])) return false;
            } else {
                $imageIndices = [];
                foreach ($config['answers'] as $answerIndex => $item) {
                    if (($item['text'] ?? '') === '') $imageIndices[] = $answerIndex;
                }
                $sourcePosition = array_search($index, $imageIndices, true);
                $order = presentationOrder(count($imageIndices), $questionId, 'blanks');
                if ($value !== (string) array_search($sourcePosition, $order, true)) return false;
            }
        }
        return true;
    }
    if ($template === 'categorize') {
        $expected = [];
        foreach ($config['categories'] as $categoryIndex => $category) {
            foreach ($category['items'] as $_) $expected[] = $categoryIndex;
        }
        $order = presentationOrder(count($expected), $questionId, 'categorize');
        $categoryOrder = $randomizeAnswers
            ? presentationOrder(count($config['categories']), $questionId, 'category-labels')
            : array_keys($config['categories']);
        $values = $answer['assignments'] ?? null;
        if (!is_array($values) || count($values) !== count($order)) return false;
        foreach ($order as $displayIndex => $sourceIndex) {
            if ((string) ($values[$displayIndex] ?? '') !== (string) array_search($expected[$sourceIndex], $categoryOrder, true)) return false;
        }
        return true;
    }
    return null;
}
