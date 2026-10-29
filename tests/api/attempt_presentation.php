<?php
declare(strict_types=1);

require __DIR__ . '/../../app/api/handlers/attempt_presentation.php';

function expectAttempt(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

$choice = ['options' => [['text' => '4', 'correct' => false], ['text' => '2', 'correct' => true]]];
$visible = playQuestionConfig('one_choice', $choice, 11, false);
expectAttempt(!isset($visible['options'][0]['correct']) && !isset($visible['options'][1]['correct']), 'Choice key leaked');
expectAttempt(gradeAttemptAnswer('one_choice', $choice, ['selected' => [1]], 11) === true, 'Correct choice was missed');
expectAttempt(gradeAttemptAnswer('one_choice', $choice, ['selected' => [0]], 11) === false, 'Wrong choice passed');

$match = ['pairs' => [
    ['keyword' => 'France', 'definition' => 'Paris'],
    ['keyword' => 'Italy', 'definition' => 'Rome'],
    ['keyword' => 'Spain', 'definition' => 'Madrid'],
]];
$visible = playQuestionConfig('match', $match, 12, false);
expectAttempt(!isset($visible['pairs'][0]['definition']) && count($visible['definitions']) === 3, 'Match key leaked');
$order = presentationOrder(3, 12, 'match');
$assignment = array_map(static fn (int $target): string => (string) array_search($target, $order, true), [0, 1, 2]);
expectAttempt(gradeAttemptAnswer('match', $match, ['assignments' => $assignment], 12) === true, 'Correct match was missed');
$assignment[0] = null;
expectAttempt(gradeAttemptAnswer('match', $match, ['assignments' => $assignment], 12) === false, 'Incomplete match passed');

$ordering = ['items' => [['text' => 'Wash'], ['text' => 'Cut'], ['text' => 'Cook']]];
$order = presentationOrder(3, 13, 'ordering');
$visible = playQuestionConfig('ordering', $ordering, 13, false);
expectAttempt($visible['items'][0] === $ordering['items'][$order[0]], 'Ordering presentation changed');
$answerOrder = array_map(static fn (int $target): int => array_search($target, $order, true), [0, 1, 2]);
expectAttempt(gradeAttemptAnswer('ordering', $ordering, ['order' => $answerOrder], 13) === true, 'Correct order was missed');

$categories = ['categories' => [
    ['name' => 'A', 'items' => [['text' => 'A1'], ['text' => 'A2']]],
    ['name' => 'B', 'items' => [['text' => 'B1']]],
]];
$visible = playQuestionConfig('categorize', $categories, 14, false);
expectAttempt(!isset($visible['categories'][0]['items']) && count($visible['items']) === 3, 'Category key leaked');
$expected = [0, 0, 1];
$assignments = array_map(static fn (int $source): string => (string) $expected[$source],
    presentationOrder(3, 14, 'categorize'));
expectAttempt(gradeAttemptAnswer('categorize', $categories, ['assignments' => $assignments], 14) === true,
    'Correct categories were missed');

$blanks = ['answers' => [['text' => 'Paris'], ['text' => '', 'image_id' => 123]]];
$visible = playQuestionConfig('fill_blanks', $blanks, 15, false);
expectAttempt($visible['answers'][0]['text'] !== 'Paris' && !isset($visible['answers'][1]['image_id'])
    && $visible['image_choices'][0]['image_id'] === 123, 'Blank key leaked');
expectAttempt(gradeAttemptAnswer('fill_blanks', $blanks, ['values' => ['paris', '0']], 15) === true,
    'Correct blanks were missed');

expectAttempt(!isset(playQuestionConfig('show_answer', ['answer' => 'Secret'], 16, false)['answer']),
    'Reveal answer leaked');
echo "Quiz presentation and grading checks passed.\n";
