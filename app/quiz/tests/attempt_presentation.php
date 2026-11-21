<?php
declare(strict_types=1);

require __DIR__ . '/../server/attempt_presentation.php';

function expectAttempt(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

$choice = ['options' => [['text' => '4', 'correct' => false], ['text' => '2', 'correct' => true]]];
$visible = playQuestionConfig('one_choice', $choice, 11, false);
expectAttempt(!isset($visible['options'][0]['correct']) && !isset($visible['options'][1]['correct']), 'Choice key leaked');
expectAttempt(gradeAttemptAnswer('one_choice', $choice, ['selected' => [1]], 11) === true, 'Correct choice was missed');
expectAttempt(gradeAttemptAnswer('one_choice', $choice, ['selected' => [0]], 11) === false, 'Wrong choice passed');
$choiceOrder = presentationOrder(2, 11, 'choices');
$shuffledChoice = playQuestionConfig('one_choice', $choice, 11, false, true);
expectAttempt($shuffledChoice['options'][0]['text'] === $choice['options'][$choiceOrder[0]]['text']
    && !isset($shuffledChoice['options'][0]['correct']), 'Choice shuffle leaked or changed options');
expectAttempt($shuffledChoice === playQuestionConfig('one_choice', $choice, 11, false, true),
    'Choice order changed on resume');
expectAttempt(gradeAttemptAnswer('one_choice', $choice,
    ['selected' => [array_search(1, $choiceOrder, true)]], 11, true) === true, 'Shuffled choice was graded incorrectly');

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
expectAttempt(countCorrectMatchChoices($match, ['assignments' => $assignment], 12) === 3,
    'Correct match choices were not counted');
$assignment[0] = null;
expectAttempt(gradeAttemptAnswer('match', $match, ['assignments' => $assignment], 12) === false, 'Incomplete match passed');
expectAttempt(countCorrectMatchChoices($match, ['assignments' => $assignment], 12) === 2,
    'Partial match choices were not counted');
expectAttempt(countCorrectMatchChoices($match, null, 12) === 0, 'Unanswered match choices were counted');
$keywordOrder = presentationOrder(3, 12, 'match-keywords');
$shuffledMatch = playQuestionConfig('match', $match, 12, false, true);
expectAttempt($shuffledMatch['pairs'][0]['keyword'] === $match['pairs'][$keywordOrder[0]]['keyword'],
    'Match row order was not applied');
$shuffledAssignment = array_map(static fn (int $source): string => (string) array_search($source, $order, true),
    $keywordOrder);
expectAttempt(gradeAttemptAnswer('match', $match, ['assignments' => $shuffledAssignment], 12, true) === true,
    'Shuffled match was graded incorrectly');
$shuffledAssignment[1] = null;
expectAttempt(countCorrectMatchChoices($match, ['assignments' => $shuffledAssignment], 12, true) === 2,
    'Shuffled partial match choices were not counted');

$diagram = ['diagram_image_id' => 25, 'labels' => [
    ['text' => 'Heart', 'x' => 42.5, 'y' => 30],
    ['text' => 'Lung', 'x' => 65, 'y' => 45],
    ['text' => 'Liver', 'x' => 55, 'y' => 72],
]];
$visible = playQuestionConfig('labeled_diagram', $diagram, 20, false);
expectAttempt(!isset($visible['labels']) && count($visible['points']) === 3
    && $visible['points'][0] === ['x' => 42.5, 'y' => 30], 'Diagram labels leaked into points');
$order = diagramLabelOrder(3, 20);
expectAttempt($visible['choices'] === array_map(static fn (int $index): string => $diagram['labels'][$index]['text'], $order),
    'Diagram labels were not presented in stable shuffled order');
$assignment = array_map(static fn (int $point): string => (string) array_search($point, $order, true), [0, 1, 2]);
expectAttempt(gradeAttemptAnswer('labeled_diagram', $diagram, ['assignments' => $assignment], 20) === true,
    'Correct diagram labels were missed');
$assignment[1] = null;
expectAttempt(gradeAttemptAnswer('labeled_diagram', $diagram, ['assignments' => $assignment], 20) === false
    && countCorrectDiagramLabels($diagram, ['assignments' => $assignment], 20) === 2,
    'Partial diagram labels were graded incorrectly');
expectAttempt(countCorrectDiagramLabels($diagram, null, 20) === 0, 'Unanswered diagram labels were counted');

$ordering = ['items' => [['text' => 'Wash'], ['text' => 'Cut'], ['text' => 'Cook']]];
$order = presentationOrder(3, 13, 'ordering');
$visible = playQuestionConfig('ordering', $ordering, 13, false);
expectAttempt($visible['items'][0] === $ordering['items'][$order[0]], 'Ordering presentation changed');
expectAttempt($visible['_ordered_for_play'] === true, 'Ordering presentation was not marked as prepared');
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
$categoryOrder = presentationOrder(2, 14, 'category-labels');
$shuffledCategories = playQuestionConfig('categorize', $categories, 14, false, true);
expectAttempt($shuffledCategories['categories'][0]['name'] === $categories['categories'][$categoryOrder[0]]['name'],
    'Category label order was not applied');
$shuffledAssignments = array_map(static fn (int $source): string =>
    (string) array_search($expected[$source], $categoryOrder, true), presentationOrder(3, 14, 'categorize'));
expectAttempt(gradeAttemptAnswer('categorize', $categories,
    ['assignments' => $shuffledAssignments], 14, true) === true, 'Shuffled categories were graded incorrectly');

$blanks = ['answers' => [['text' => 'Paris'], ['text' => '', 'image_id' => 123]]];
$visible = playQuestionConfig('fill_blanks', $blanks, 15, false);
expectAttempt($visible['answers'][0]['text'] !== 'Paris' && !isset($visible['answers'][1]['image_id'])
    && $visible['image_choices'][0]['image_id'] === 123, 'Blank key leaked');
expectAttempt(gradeAttemptAnswer('fill_blanks', $blanks, ['values' => ['paris', '0']], 15) === true,
    'Correct blanks were missed');

expectAttempt(!isset(playQuestionConfig('show_answer', ['answer' => 'Secret'], 16, false)['answer']),
    'Reveal answer leaked');
echo "Quiz presentation and grading checks passed.\n";
