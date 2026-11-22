<?php
declare(strict_types=1);

function respond(int $status, array $body): never
{
    throw new DomainException($status . ': ' . ($body['error'] ?? 'Unknown error'));
}

require __DIR__ . '/../server/questions.php';
require __DIR__ . '/../server/attempt_presentation.php';

function expectCrossword(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

$entries = [
    ['answer' => 'cat', 'clue' => 'A small feline', 'row' => 0, 'col' => 0, 'direction' => 'across'],
    ['answer' => 'tar', 'clue' => 'Dark road material', 'row' => 0, 'col' => 2, 'direction' => 'down'],
];
[$template, , $json] = readQuestionFields([
    'template' => 'crossword', 'prompt' => 'Solve the crossword', 'config' => ['entries' => $entries],
]);
$config = json_decode($json, true);
expectCrossword($template === 'crossword' && $config['entries'][0]['answer'] === 'CAT',
    'Crossword answers were not normalized');
$visible = playQuestionConfig('crossword', $config, 1, false);
expectCrossword(!isset($visible['entries'][0]['answer']) && $visible['entries'][0]['length'] === 3
    && $visible['entries'][0]['clue'] === 'A small feline', 'Crossword answer leaked in play');
$cells = ['0,0' => 'C', '0,1' => 'A', '0,2' => 'T', '1,2' => 'A', '2,2' => 'R'];
expectCrossword(gradeAttemptAnswer('crossword', $config, ['cells' => $cells], 1) === true,
    'Correct crossword was not graded');
$cells['1,2'] = 'X';
expectCrossword(gradeAttemptAnswer('crossword', $config, ['cells' => $cells], 1) === false,
    'Wrong crossword passed');
expectCrossword(gradeAttemptAnswer('crossword', $config, ['cells' => []], 1) === false,
    'Empty crossword passed');

foreach ([
    array_slice($entries, 0, 1),
    [$entries[0], ['answer' => 'DOG', 'clue' => 'Canine', 'row' => 0, 'col' => 2, 'direction' => 'down']],
    [$entries[0], ['answer' => 'TAR', 'clue' => '', 'row' => 0, 'col' => 2, 'direction' => 'down']],
    [$entries[0], ['answer' => 'TAR', 'clue' => 'Road material', 'row' => 60, 'col' => 2, 'direction' => 'down']],
] as $invalid) {
    try {
        readQuestionFields(['template' => 'crossword', 'prompt' => 'Solve', 'config' => ['entries' => $invalid]]);
        throw new RuntimeException('Invalid crossword was accepted');
    } catch (DomainException $error) {
        expectCrossword(str_starts_with($error->getMessage(), '400:'), 'Invalid crossword did not return 400');
    }
}

echo "Crossword question checks passed.\n";
