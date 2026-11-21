<?php
declare(strict_types=1);

function respond(int $status, array $body): never
{
    throw new DomainException($status . ': ' . ($body['error'] ?? 'Unknown error'));
}

require __DIR__ . '/../server/questions.php';

function expectWheel(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

function wheelPayload(array $options): array
{
    return ['template' => 'wheel', 'prompt' => 'Choose a color', 'config' => ['options' => $options]];
}

[$template, $prompt, $config] = readQuestionFields(wheelPayload([' Red ', 'Blue']));
expectWheel($template === 'wheel' && $prompt === 'Choose a color'
    && json_decode($config, true)['options'] === ['Red', 'Blue'], 'Valid wheel options were not normalized');
$many = array_map(static fn (int $index): string => "Option {$index}", range(1, 40));
[, , $config] = readQuestionFields(wheelPayload($many));
expectWheel(count(json_decode($config, true)['options']) === 40, 'Wheel options were capped');

foreach ([['Only one'], ['Same', 'Same'], ['', 'Blue']] as $options) {
    try {
        readQuestionFields(wheelPayload($options));
        throw new RuntimeException('Invalid wheel options were accepted');
    } catch (DomainException $error) {
        expectWheel(str_starts_with($error->getMessage(), '400:'), 'Invalid wheel options did not return 400');
    }
}

echo "Wheel question validation checks passed.\n";
