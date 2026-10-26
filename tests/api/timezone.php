<?php
declare(strict_types=1);

require __DIR__ . '/../../app/api/lib/timezone.php';

function expectTimezone(?string $expected, array $payload, string $case): void
{
    $actual = detectUserTimezone($payload);
    if ($actual !== $expected) {
        fwrite(STDERR, "{$case}: expected " . var_export($expected, true)
            . ', got ' . var_export($actual, true) . "\n");
        exit(1);
    }
}

$_SERVER['HTTP_X_TIMEZONE'] = 'Europe/Vilnius';
$_SERVER['HTTP_TIMEZONE'] = 'America/New_York';
$_COOKIE['timezone'] = 'Asia/Tokyo';
$payload = ['timezone' => 'UTC'];

expectTimezone('Europe/Vilnius', $payload, 'X-Timezone header wins');
unset($_SERVER['HTTP_X_TIMEZONE']);
expectTimezone('America/New_York', $payload, 'Timezone header wins');
unset($_SERVER['HTTP_TIMEZONE']);
expectTimezone('Asia/Tokyo', $payload, 'cookie wins');
unset($_COOKIE['timezone']);
expectTimezone('UTC', $payload, 'body fallback');

$_SERVER['HTTP_X_TIMEZONE'] = 'Invalid/Zone';
expectTimezone('UTC', $payload, 'invalid higher-priority value is skipped');
expectTimezone(null, [], 'invalid value without fallback');

echo "Timezone precedence checks passed.\n";
