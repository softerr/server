<?php
declare(strict_types=1);

const MUSICO_ANALYSIS_COLUMNS = ['duration_ms', 'bit_rate', 'sample_rate_hz', 'bit_depth',
    'channels', 'codec', 'estimated_bpm', 'estimated_key', 'peak_db', 'average_db',
    'dynamic_range_db', 'analysis_saved_at'];

function musicoAnalysisProjection(string $alias = ''): string
{
    $prefix = $alias === '' ? '' : $alias . '.';
    return implode(', ', array_map(static fn (string $column): string => $prefix . $column,
        MUSICO_ANALYSIS_COLUMNS));
}

function publicMusicoAnalysis(array $row): ?array
{
    if ($row['analysis_saved_at'] === null) return null;
    $integers = ['duration_ms', 'bit_rate', 'sample_rate_hz', 'bit_depth', 'channels', 'estimated_bpm'];
    $decimals = ['peak_db', 'average_db', 'dynamic_range_db'];
    $analysis = [];
    foreach (MUSICO_ANALYSIS_COLUMNS as $column) {
        if ($column === 'analysis_saved_at') continue;
        $value = $row[$column];
        $analysis[$column] = $value === null ? null
            : (in_array($column, $integers, true) ? (int) $value
                : (in_array($column, $decimals, true) ? (float) $value : $value));
    }
    return $analysis;
}

function musicoAnalysisInteger(array $body, string $key, int $min, int $max): ?int
{
    if (!array_key_exists($key, $body)) respond(400, ['error' => "Missing {$key}"]);
    return musicoOptionalNumber($body[$key], $min, $max, $key);
}

function musicoAnalysisDecimal(array $body, string $key, float $min, float $max): ?float
{
    if (!array_key_exists($key, $body)) respond(400, ['error' => "Missing {$key}"]);
    $value = $body[$key];
    if ($value === null) return null;
    if ((!is_int($value) && !is_float($value)) || !is_finite((float) $value)
        || $value < $min || $value > $max) respond(400, ['error' => "Invalid {$key}"]);
    return round((float) $value, 2);
}

function musicoAnalysisText(array $body, string $key, int $maxBytes): ?string
{
    if (!array_key_exists($key, $body)) respond(400, ['error' => "Missing {$key}"]);
    return $body[$key] === null ? null : musicoText($body[$key], $maxBytes, $key);
}

function handleSaveMusicoTrackAnalysis(array $authUser, int $id): never
{
    $expected = requiredMusicoVersion();
    $body = readJsonBody();
    if ($body === null) respond(400, ['error' => 'Invalid analysis']);
    $keys = array_slice(MUSICO_ANALYSIS_COLUMNS, 0, -1);
    foreach (array_keys($body) as $key) {
        if (!in_array($key, $keys, true)) respond(400, ['error' => "Unknown {$key}"]);
    }
    $analysis = [
        'duration_ms' => musicoAnalysisInteger($body, 'duration_ms', 0, 86400000),
        'bit_rate' => musicoAnalysisInteger($body, 'bit_rate', 1, 1000000000),
        'sample_rate_hz' => musicoAnalysisInteger($body, 'sample_rate_hz', 1, 1000000),
        'bit_depth' => musicoAnalysisInteger($body, 'bit_depth', 1, 64),
        'channels' => musicoAnalysisInteger($body, 'channels', 1, 64),
        'codec' => musicoAnalysisText($body, 'codec', 100),
        'estimated_bpm' => musicoAnalysisInteger($body, 'estimated_bpm', 30, 300),
        'estimated_key' => musicoAnalysisText($body, 'estimated_key', 32),
        'peak_db' => musicoAnalysisDecimal($body, 'peak_db', -200, 20),
        'average_db' => musicoAnalysisDecimal($body, 'average_db', -200, 20),
        'dynamic_range_db' => musicoAnalysisDecimal($body, 'dynamic_range_db', 0, 220),
    ];
    $db = connectMusicoDb();
    beginMusicoMutation($db, $authUser);
    assertMusicoVersion($db, $authUser, 'track', $id, $expected);
    $assignments = [];
    foreach (array_keys($analysis) as $index => $column) {
        $assignments[] = $column . ' = $' . ($index + 1);
    }
    $values = array_values($analysis);
    $trackPlaceholder = '$' . (count($values) + 1);
    $values[] = $id;
    $userPlaceholder = '$' . (count($values) + 1);
    $values[] = $authUser['id'];
    $updated = @pg_query_params($db,
        'UPDATE public.track t SET ' . implode(', ', $assignments) . ', analysis_saved_at = CURRENT_TIMESTAMP,
             version = t.version + 1
         FROM public."user" u WHERE t.id = ' . $trackPlaceholder . ' AND t.user_id = u.id
            AND u.auth_user_id = ' . $userPlaceholder . '
         RETURNING ' . musicoAnalysisProjection('t') . ', t.version', $values);
    if ($updated === false) respond(500, ['error' => 'Could not save analysis']);
    $row = pg_fetch_assoc($updated);
    if ($row === false) respond(404, ['error' => 'Track not found']);
    recordMusicoChange($db, $authUser, 'track', $id);
    finishMusicoMutation($db);
    header('ETag: "v' . $row['version'] . '"');
    respond(200, ['analysis' => publicMusicoAnalysis($row), 'version' => (int) $row['version']]);
}

