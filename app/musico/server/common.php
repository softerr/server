<?php
declare(strict_types=1);

require_once __DIR__ . '/artwork_names.php';

const MUSICO_TRACK_MAX_BYTES = MEDIA_AUDIO_MAX_BYTES;
const MUSICO_USER_MAX_BYTES = MEDIA_AUDIO_USER_MAX_BYTES;
function musicoText(mixed $value, int $maxBytes, string $label): string
{
    if (!is_string($value) || strlen($value) > $maxBytes || preg_match('//u', $value) !== 1
        || preg_match('/[\x00-\x1f\x7f]/u', $value)) {
        respond(400, ['error' => "Invalid {$label}"]);
    }
    $text = trim($value);
    if ($text === '' || strlen($text) > $maxBytes) respond(400, ['error' => "Invalid {$label}"]);
    return $text;
}

function musicoCurrentId($db, array $authUser): ?int
{
    $result = @pg_query_params($db, 'SELECT id FROM public."user" WHERE auth_user_id = $1', [$authUser['id']]);
    if ($result === false) respond(500, ['error' => 'Failed to load Musico account']);
    if (pg_num_rows($result) === 0) return null;
    $id = pg_fetch_result($result, 0, 0);
    return $id === false ? null : (int) $id;
}

function beginMusicoMutation($db, array $authUser): void
{
    if (@pg_query($db, 'BEGIN') === false
        || @pg_query_params($db, 'SELECT pg_advisory_xact_lock($1)', [$authUser['id']]) === false) {
        respond(500, ['error' => 'Failed to update Musico']);
    }
    $active = @pg_query_params(connectDb(),
        'SELECT 1 FROM public."user" WHERE id = $1 AND verified = TRUE
         AND approved_at IS NOT NULL AND deleting = FALSE', [$authUser['id']]);
    if ($active === false) respond(500, ['error' => 'Failed to authorize Musico account']);
    if (pg_num_rows($active) === 0) respond(401, ['error' => 'Not authenticated']);
}

function ensureMusicoUserId($db, array $authUser): int
{
    $created = @pg_query_params($db,
        'INSERT INTO public."user" (auth_user_id) VALUES ($1) ON CONFLICT (auth_user_id) DO NOTHING',
        [$authUser['id']]);
    if ($created === false) respond(500, ['error' => 'Failed to initialize Musico account']);
    $id = musicoCurrentId($db, $authUser);
    if ($id === null) respond(500, ['error' => 'Failed to initialize Musico account']);
    return $id;
}

function finishMusicoMutation($db): void
{
    if (@pg_query($db, 'COMMIT') === false) respond(500, ['error' => 'Failed to update Musico']);
}

function requiredMusicoVersion(string $kind = 'v'): int
{
    $header = $_SERVER['HTTP_IF_MATCH'] ?? null;
    if ($header === null) respond(428, ['error' => 'If-Match is required']);
    if (!is_string($header) || preg_match('/^"' . $kind . '([1-9][0-9]*)"$/D', $header, $match) !== 1) {
        respond(400, ['error' => 'Invalid If-Match']);
    }
    $version = filter_var($match[1], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    if ($version === false) respond(400, ['error' => 'Invalid If-Match']);
    return $version;
}

function assertMusicoVersion($db, array $authUser, string $resource, int $id,
    int $expected, bool $stats = false): void
{
    if ($resource !== 'track' && $resource !== 'playlist') {
        throw new LogicException('Invalid Musico resource');
    }
    $column = $stats ? 'stats_version' : 'version';
    $result = @pg_query_params($db,
        'SELECT item.' . $column . ' FROM public.' . $resource . ' item
         JOIN public."user" u ON u.id = item.user_id
         WHERE item.id = $1 AND u.auth_user_id = $2', [$id, $authUser['id']]);
    if ($result === false) respond(500, ['error' => 'Could not check Musico version']);
    $row = pg_fetch_assoc($result);
    if ($row === false) respond(404, ['error' => ucfirst($resource) . ' not found']);
    $current = (int) $row[$column];
    if ($current !== $expected) {
        header('ETag: "' . ($stats ? 's' : 'v') . $current . '"');
        respond(412, ['error' => 'This item changed. Reload the page before retrying.',
            'current_version' => $current]);
    }
}

function recordMusicoChange($db, array $authUser, string $resource, int $resourceId,
    string $action = 'upsert'): void
{
    $saved = @pg_query_params($db,
        'INSERT INTO public.change_log (user_id, resource, resource_id, action)
         SELECT id, $2, $3, $4 FROM public."user" WHERE auth_user_id = $1',
        [$authUser['id'], $resource, $resourceId, $action]);
    if ($saved === false || pg_affected_rows($saved) !== 1) {
        respond(500, ['error' => 'Could not record Musico change']);
    }
}

function handleMusicoMe(array $authUser): never
{
    $db = connectMusicoDb();
    beginMusicoMutation($db, $authUser);
    $id = ensureMusicoUserId($db, $authUser);
    finishMusicoMutation($db);
    header('Cache-Control: private, no-store');
    respond(200, ['id' => $id, 'auth_user_id' => (int) $authUser['id']]);
}

