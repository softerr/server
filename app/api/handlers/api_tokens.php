<?php
declare(strict_types=1);

const API_TOKEN_SCOPES = ['quiz:read', 'quiz:write', 'musico:read', 'musico:write',
    'mdb:read', 'mdb:write', 'media:read', 'media:write'];
const API_TOKEN_MAX_QUIZ_GRANTS = 1000;

function validatedAppAccess(mixed $input, array $scopes): array
{
    if (!is_array($input) || count($input) !== 2
        || !array_key_exists('musico', $input) || !array_key_exists('mdb', $input)) {
        respond(400, ['error' => 'Invalid app access']);
    }
    foreach (['musico', 'mdb'] as $app) {
        $access = $input[$app];
        if (!is_string($access) || !in_array($access, ['none', 'read', 'edit'], true)) {
            respond(400, ['error' => 'Invalid app access']);
        }
        if ($access !== 'none' && !in_array("{$app}:read", $scopes, true)) {
            respond(400, ['error' => 'App access requires matching read scope']);
        }
        if ($access === 'edit' && !in_array("{$app}:write", $scopes, true)) {
            respond(400, ['error' => 'App edit access requires matching write scope']);
        }
    }
    return $input;
}

function publicAppAccess(array $row): array
{
    $access = json_decode($row['app_access'], true) ?: [];
    return ['musico' => $access['musico'] ?? 'none', 'mdb' => $access['mdb'] ?? 'none'];
}

function validatedQuizAccess(int $ownerId, mixed $input, array $scopes): array
{
    if (!is_array($input) || !is_string($input['all'] ?? null)
        || !in_array($input['all'], ['none', 'read', 'edit'], true)
        || !is_array($input['quizzes'] ?? null) || !array_is_list($input['quizzes'])
        || count($input['quizzes']) > API_TOKEN_MAX_QUIZ_GRANTS
        || ($input['all'] !== 'none' && $input['quizzes'] !== [])) {
        respond(400, ['error' => 'Invalid quiz access']);
    }
    $permissions = [];
    foreach ($input['quizzes'] as $grant) {
        if (!is_array($grant) || !is_int($grant['id'] ?? null) || $grant['id'] < 1
            || !in_array($grant['permission'] ?? null, ['read', 'edit'], true)
            || isset($permissions[(string) $grant['id']])) {
            respond(400, ['error' => 'Invalid quiz access']);
        }
        $permissions[(string) $grant['id']] = $grant['permission'];
    }
    $needsRead = $input['all'] !== 'none' || $permissions !== [];
    $needsEdit = $input['all'] === 'edit' || in_array('edit', $permissions, true);
    if (($needsRead && !in_array('quiz:read', $scopes, true))
        || ($needsEdit && !in_array('quiz:write', $scopes, true))) {
        respond(400, ['error' => 'Quiz access requires matching quiz scopes']);
    }
    if ($permissions !== []) {
        $quizDb = connectQuizDb();
        $result = @pg_query_params($quizDb,
            'SELECT COUNT(*) FROM public.quiz q JOIN public."user" u ON u.id = q.user_id
             WHERE u.auth_user_id = $1 AND q.id = ANY($2::bigint[])',
            [$ownerId, '{' . implode(',', array_keys($permissions)) . '}']);
        if ($result === false) respond(500, ['error' => 'Failed to validate quiz access']);
        if ((int) pg_fetch_result($result, 0, 0) !== count($permissions)) {
            respond(400, ['error' => 'Quiz access includes a quiz you do not own']);
        }
    }
    return [$input['all'] === 'read', $input['all'] === 'edit', $permissions];
}

function publicQuizAccess(array $row): array
{
    $permissions = json_decode($row['quiz_permissions'], true) ?: [];
    $quizzes = [];
    foreach ($permissions as $id => $permission) {
        $quizzes[] = ['id' => (int) $id, 'permission' => $permission];
    }
    return [
        'all' => $row['edit_owner_quizzes'] === 't' ? 'edit'
            : ($row['read_owner_quizzes'] === 't' ? 'read' : 'none'),
        'quizzes' => $quizzes,
    ];
}

function tokenTimestamp(?string $value): ?string
{
    return $value === null ? null : (new DateTimeImmutable($value))->format(DATE_ATOM);
}

function requireTokenOwner(): array
{
    $user = currentSessionUser();
    if (($user['account_kind'] ?? 'human') !== 'human') {
        respond(403, ['error' => 'Browser session required']);
    }
    header('Cache-Control: private, no-store');
    return $user;
}

function publicApiToken(array $row): array
{
    return [
        'id' => (int) $row['id'],
        'name' => $row['name'],
        'user_id' => (int) $row['user_id'],
        'username' => $row['username'],
        'quiz_access' => publicQuizAccess($row),
        'app_access' => publicAppAccess($row),
        'scopes' => json_decode($row['scopes'], true),
        'created' => tokenTimestamp($row['created']),
        'expires' => tokenTimestamp($row['expires']),
        'last_used_at' => tokenTimestamp($row['last_used_at']),
        'revoked_at' => tokenTimestamp($row['revoked_at']),
    ];
}

function handleListApiTokens(): never
{
    $owner = requireTokenOwner();
    $db = connectDb();
    $result = @pg_query_params($db,
        'SELECT t.id, t.name, t.user_id, u.display_name AS username,
                t.scopes, t.read_owner_quizzes, t.edit_owner_quizzes, t.quiz_permissions,
                t.app_access,
                t.created, t.expires, t.last_used_at, t.revoked_at
         FROM public.api_token t JOIN public."user" u ON u.id = t.user_id
         WHERE t.created_by = $1
         ORDER BY CASE WHEN t.revoked_at IS NULL
             AND (t.expires IS NULL OR t.expires > CURRENT_TIMESTAMP) THEN 0 ELSE 1 END,
             t.id DESC LIMIT 100', [(int) $owner['id']]);
    if ($result === false) respond(500, ['error' => 'Failed to list API tokens']);
    $tokens = [];
    while (($row = pg_fetch_assoc($result)) !== false) $tokens[] = publicApiToken($row);
    respond(200, ['tokens' => $tokens]);
}

function handleCreateApiToken(): never
{
    $owner = requireTokenOwner();
    $payload = readJsonBody(262144);
    $name = $payload['name'] ?? null;
    $scopes = $payload['scopes'] ?? null;
    $days = $payload['expires_in_days'] ?? null;
    $quizAccess = $payload['quiz_access'] ?? ['all' => 'none', 'quizzes' => []];
    $appAccess = $payload['app_access'] ?? ['musico' => 'none', 'mdb' => 'none'];
    if ($payload === null || !array_key_exists('expires_in_days', $payload)
        || !is_string($name) || trim($name) === '' || strlen(trim($name)) > 100
        || preg_match('//u', $name) !== 1
        || preg_match('/[\x00-\x1F\x7F]/u', $name) === 1
        || !is_array($scopes) || !array_is_list($scopes) || $scopes === []
        || count($scopes) > count(API_TOKEN_SCOPES)
        || count(array_filter($scopes, static fn ($scope) => is_string($scope)
            && in_array($scope, API_TOKEN_SCOPES, true))) !== count($scopes)
        || count(array_unique($scopes)) !== count($scopes)
        || ($days !== null && (!is_int($days) || $days < 1 || $days > 365))) {
        respond(400, ['error' => 'Invalid token name, scopes, or expiry']);
    }
    $db = connectDb();
    if (@pg_query($db, 'BEGIN') === false) respond(500, ['error' => 'Failed to create API token']);
    $target = @pg_query_params($db,
        'SELECT id FROM public."user" WHERE id = $1 AND account_kind = \'human\'
         AND verified = TRUE AND approved_at IS NOT NULL AND deleting = FALSE FOR UPDATE',
        [$owner['id']]);
    if ($target === false || pg_num_rows($target) === 0) {
        respond(403, ['error' => 'Account is not active']);
    }
    $limits = @pg_query_params($db,
        'SELECT COUNT(*) FILTER (WHERE revoked_at IS NULL
            AND (expires IS NULL OR expires > CURRENT_TIMESTAMP)) AS active,
            COUNT(*) FILTER (WHERE created > CURRENT_TIMESTAMP - INTERVAL \'1 day\') AS recent
         FROM public.api_token WHERE created_by = $1', [$owner['id']]);
    if ($limits === false) respond(500, ['error' => 'Failed to check token limit']);
    $counts = pg_fetch_assoc($limits);
    if ((int) $counts['active'] >= 100 || (int) $counts['recent'] >= 20) {
        respond(429, ['error' => 'API token limit reached']);
    }
    [$allRead, $allEdit, $permissions] = validatedQuizAccess((int) $owner['id'], $quizAccess, $scopes);
    $appAccess = validatedAppAccess($appAccess, $scopes);
    $service = @pg_query_params($db,
        'INSERT INTO public."user"
            (username, account_kind, service_owner_id, display_name, verified, approved_at)
         VALUES ($1, \'service\', $2, $3, TRUE, CURRENT_TIMESTAMP) RETURNING id',
        ['bot_' . bin2hex(random_bytes(16)), $owner['id'], trim($name)]);
    if ($service === false) respond(500, ['error' => 'Failed to create service account']);
    $serviceId = pg_fetch_result($service, 0, 0);
    $token = 'sat_' . rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
    $result = @pg_query_params($db,
        'INSERT INTO public.api_token (user_id, created_by, name, token_hash, scopes, expires,
            read_owner_quizzes, edit_owner_quizzes, quiz_permissions, app_access)
         VALUES ($1, $2, $3, $4, $5::jsonb, CURRENT_TIMESTAMP + ($6::int * INTERVAL \'1 day\'),
            $7, $8, $9::jsonb, $10::jsonb)
         RETURNING id, created, expires',
        [$serviceId, $owner['id'], trim($name), hash('sha256', $token),
         json_encode($scopes, JSON_THROW_ON_ERROR), $days, $allRead ? 't' : 'f', $allEdit ? 't' : 'f',
         json_encode((object) $permissions, JSON_THROW_ON_ERROR),
         json_encode($appAccess, JSON_THROW_ON_ERROR)]);
    if ($result === false || @pg_query($db, 'COMMIT') === false) {
        respond(500, ['error' => 'Failed to create API token']);
    }
    $row = pg_fetch_assoc($result);
    respond(201, ['id' => (int) $row['id'], 'user_id' => (int) $serviceId, 'token' => $token,
        'expires' => tokenTimestamp($row['expires'])]);
}

function handleRevokeApiToken(int $tokenId): never
{
    $owner = requireTokenOwner();
    $db = connectDb();
    $result = @pg_query_params($db,
        'UPDATE public.api_token SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP)
         WHERE id = $1 AND created_by = $2 RETURNING id', [$tokenId, $owner['id']]);
    if ($result === false) {
        respond(500, ['error' => 'Failed to revoke API token']);
    }
    if (pg_num_rows($result) === 0) respond(404, ['error' => 'API token not found']);
    http_response_code(204);
    exit;
}

function handleUpdateApiTokenQuizAccess(int $tokenId): never
{
    $owner = requireTokenOwner();
    $payload = readJsonBody(262144);
    if ($payload === null || !array_key_exists('quiz_access', $payload)) {
        respond(400, ['error' => 'Quiz access is required']);
    }
    $db = connectDb();
    if (@pg_query($db, 'BEGIN') === false) respond(500, ['error' => 'Failed to update quiz access']);
    $result = @pg_query_params($db,
        'SELECT scopes, revoked_at, expires FROM public.api_token
         WHERE id = $1 AND created_by = $2 FOR UPDATE', [$tokenId, $owner['id']]);
    if ($result === false) respond(500, ['error' => 'Failed to update quiz access']);
    $token = pg_fetch_assoc($result);
    if ($token === false) respond(404, ['error' => 'API token not found']);
    if ($token['revoked_at'] !== null || ($token['expires'] !== null
        && new DateTimeImmutable($token['expires']) <= new DateTimeImmutable())) {
        respond(409, ['error' => 'Token is no longer active']);
    }
    $scopes = json_decode($token['scopes'], true);
    [$allRead, $allEdit, $permissions] = validatedQuizAccess(
        (int) $owner['id'], $payload['quiz_access'], $scopes ?: []);
    $updated = @pg_query_params($db,
        'UPDATE public.api_token SET read_owner_quizzes = $1,
            edit_owner_quizzes = $2, quiz_permissions = $3::jsonb WHERE id = $4',
        [$allRead ? 't' : 'f', $allEdit ? 't' : 'f',
         json_encode((object) $permissions, JSON_THROW_ON_ERROR), $tokenId]);
    if ($updated === false || @pg_query($db, 'COMMIT') === false) {
        respond(500, ['error' => 'Failed to update quiz access']);
    }
    respond(200, ['quiz_access' => [
        'all' => $allEdit ? 'edit' : ($allRead ? 'read' : 'none'),
        'quizzes' => array_map(static fn ($id, $permission): array =>
            ['id' => (int) $id, 'permission' => $permission],
            array_keys($permissions), array_values($permissions)),
    ]]);
}

function handleUpdateApiTokenAppAccess(int $tokenId): never
{
    $owner = requireTokenOwner();
    $payload = readJsonBody(262144);
    if ($payload === null || !array_key_exists('app_access', $payload)) {
        respond(400, ['error' => 'App access is required']);
    }
    $db = connectDb();
    if (@pg_query($db, 'BEGIN') === false) respond(500, ['error' => 'Failed to update app access']);
    $result = @pg_query_params($db,
        'SELECT scopes, revoked_at, expires FROM public.api_token
         WHERE id = $1 AND created_by = $2 FOR UPDATE', [$tokenId, $owner['id']]);
    if ($result === false) respond(500, ['error' => 'Failed to update app access']);
    $token = pg_fetch_assoc($result);
    if ($token === false) respond(404, ['error' => 'API token not found']);
    if ($token['revoked_at'] !== null || ($token['expires'] !== null
        && new DateTimeImmutable($token['expires']) <= new DateTimeImmutable())) {
        respond(409, ['error' => 'Token is no longer active']);
    }
    $access = validatedAppAccess($payload['app_access'], json_decode($token['scopes'], true) ?: []);
    $updated = @pg_query_params($db,
        'UPDATE public.api_token SET app_access = $1::jsonb WHERE id = $2',
        [json_encode($access, JSON_THROW_ON_ERROR), $tokenId]);
    if ($updated === false || @pg_query($db, 'COMMIT') === false) {
        respond(500, ['error' => 'Failed to update app access']);
    }
    respond(200, ['app_access' => $access]);
}

function handleApiTokenActivity(int $tokenId): never
{
    $owner = requireTokenOwner();
    $db = connectDb();
    $token = @pg_query_params($db,
        'SELECT id FROM public.api_token WHERE id = $1 AND created_by = $2',
        [$tokenId, $owner['id']]);
    if ($token === false) respond(500, ['error' => 'Failed to load token activity']);
    if (pg_num_rows($token) === 0) respond(404, ['error' => 'API token not found']);
    $result = @pg_query_params($db,
        'SELECT id, method, path, status, created FROM public.api_token_activity
         WHERE token_id = $1 ORDER BY id DESC LIMIT 100', [$tokenId]);
    if ($result === false) respond(500, ['error' => 'Failed to load token activity']);
    $activity = [];
    while (($row = pg_fetch_assoc($result)) !== false) {
        $activity[] = [
            'id' => (int) $row['id'], 'method' => $row['method'], 'path' => $row['path'],
            'status' => (int) $row['status'], 'created' => tokenTimestamp($row['created']),
        ];
    }
    respond(200, ['activity' => $activity]);
}
