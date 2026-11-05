<?php
declare(strict_types=1);

const MOBILE_ACCESS_SECONDS = 900;
const MOBILE_REFRESH_SECONDS = 2592000;

function newMobileToken(string $prefix): string
{
    return $prefix . rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
}

function mobileTokenHash(mixed $token, string $prefix): string
{
    if (!is_string($token) || preg_match('/^' . $prefix . '[A-Za-z0-9_-]{43}$/D', $token) !== 1) {
        respond(400, ['error' => 'Invalid mobile token']);
    }
    return hash('sha256', $token);
}

function rotatedMobileTokens(string $oldRefreshToken, string $nonce): array
{
    $encode = static fn (string $bytes): string => rtrim(strtr(base64_encode($bytes), '+/', '-_'), '=');
    return [
        'mat_' . $encode(hash_hmac('sha256', 'mobile-access:' . $nonce, $oldRefreshToken, true)),
        'mrt_' . $encode(hash_hmac('sha256', 'mobile-refresh:' . $nonce, $oldRefreshToken, true)),
    ];
}

function mobileTokenResponse(array $user, string $accessToken, string $refreshToken,
    int $accessSeconds = MOBILE_ACCESS_SECONDS, int $refreshSeconds = MOBILE_REFRESH_SECONDS): never
{
    header('Cache-Control: no-store');
    respond(200, [
        'token_type' => 'Bearer',
        'access_token' => $accessToken,
        'expires_in' => $accessSeconds,
        'refresh_token' => $refreshToken,
        'refresh_expires_in' => $refreshSeconds,
        'user' => publicUser($user),
    ]);
}

function handleMobileLogin(): never
{
    $payload = readJsonBody();
    $user = authenticateLoginCredentials($payload);
    $deviceName = $payload['device_name'] ?? null;
    if ($deviceName !== null && (!is_string($deviceName) || trim($deviceName) === ''
        || strlen($deviceName) > 100 || preg_match('//u', $deviceName) !== 1
        || preg_match('/[\x00-\x1f\x7f]/u', $deviceName))) {
        respond(400, ['error' => 'Invalid device name']);
    }
    $accessToken = newMobileToken('mat_');
    $refreshToken = newMobileToken('mrt_');
    $db = connectDb();
    $saved = @pg_query_params($db,
        'INSERT INTO public.mobile_session (user_id, device_name, access_hash, refresh_hash,
             password_fingerprint, access_expires, refresh_expires)
         VALUES ($1, $2, $3, $4, $5,
             CURRENT_TIMESTAMP + INTERVAL \'15 minutes\', CURRENT_TIMESTAMP + INTERVAL \'30 days\')',
        [$user['id'], $deviceName === null ? null : trim($deviceName), hash('sha256', $accessToken),
            hash('sha256', $refreshToken), hash('sha256', $user['password'])]);
    if ($saved === false) respond(500, ['error' => 'Failed to create mobile session']);
    mobileTokenResponse($user, $accessToken, $refreshToken);
}

function handleMobileRefresh(): never
{
    $payload = readJsonBody();
    $oldRefreshToken = $payload['refresh_token'] ?? null;
    $refreshHash = mobileTokenHash($oldRefreshToken, 'mrt_');
    $db = connectDb();
    if (@pg_query($db, 'BEGIN') === false) respond(500, ['error' => 'Failed to refresh mobile session']);
    $result = @pg_query_params($db,
        'SELECT s.id AS session_id, s.access_hash, s.refresh_hash, s.rotation_nonce,
                GREATEST(0, CEIL(EXTRACT(EPOCH FROM s.access_expires - clock_timestamp())))::int AS access_seconds,
                GREATEST(0, CEIL(EXTRACT(EPOCH FROM s.refresh_expires - clock_timestamp())))::int AS refresh_seconds,
                u.id, u.username, u.email, u.role, u.password, u.verified,
                u.approved_at, u.created, u.account_kind
         FROM public.mobile_session s JOIN public."user" u ON u.id = s.user_id
         WHERE (s.refresh_hash = $1 OR (s.previous_refresh_hash = $1
             AND s.previous_refresh_until > clock_timestamp()))
           AND s.revoked_at IS NULL AND s.refresh_expires > clock_timestamp()
           AND u.account_kind = \'human\' AND u.verified = TRUE
           AND u.approved_at IS NOT NULL AND u.deleting = FALSE
           AND s.password_fingerprint = encode(digest(u.password, \'sha256\'), \'hex\')
         FOR UPDATE OF s', [$refreshHash]);
    if ($result === false) respond(500, ['error' => 'Failed to refresh mobile session']);
    $row = pg_fetch_assoc($result);
    if ($row === false) respond(401, ['error' => 'Mobile session expired']);
    if (hash_equals(trim($row['refresh_hash']), $refreshHash)) {
        $nonce = bin2hex(random_bytes(32));
        [$accessToken, $refreshToken] = rotatedMobileTokens($oldRefreshToken, $nonce);
        $updated = @pg_query_params($db,
            'UPDATE public.mobile_session SET access_hash = $1, refresh_hash = $2,
                 previous_refresh_hash = $3,
                 previous_refresh_until = clock_timestamp() + INTERVAL \'60 seconds\',
                 rotation_nonce = $4,
                 access_expires = clock_timestamp() + INTERVAL \'15 minutes\',
                 refresh_expires = clock_timestamp() + INTERVAL \'30 days\',
                 last_used_at = clock_timestamp()
             WHERE id = $5',
            [hash('sha256', $accessToken), hash('sha256', $refreshToken), $refreshHash,
                $nonce, $row['session_id']]);
        if ($updated === false || pg_affected_rows($updated) !== 1) {
            respond(500, ['error' => 'Failed to refresh mobile session']);
        }
        if (@pg_query($db, 'COMMIT') === false) respond(500, ['error' => 'Failed to refresh mobile session']);
        mobileTokenResponse($row, $accessToken, $refreshToken);
    }
    $nonce = $row['rotation_nonce'];
    if (!is_string($nonce) || preg_match('/^[0-9a-f]{64}$/D', $nonce) !== 1) {
        respond(401, ['error' => 'Mobile session expired']);
    }
    [$accessToken, $refreshToken] = rotatedMobileTokens($oldRefreshToken, $nonce);
    if (!hash_equals(trim($row['access_hash']), hash('sha256', $accessToken))
        || !hash_equals(trim($row['refresh_hash']), hash('sha256', $refreshToken))) {
        respond(401, ['error' => 'Mobile session expired']);
    }
    if (@pg_query($db, 'COMMIT') === false) respond(500, ['error' => 'Failed to refresh mobile session']);
    mobileTokenResponse($row, $accessToken, $refreshToken,
        (int) $row['access_seconds'], (int) $row['refresh_seconds']);
}

function handleMobileLogout(): never
{
    $payload = readJsonBody();
    $refreshHash = mobileTokenHash($payload['refresh_token'] ?? null, 'mrt_');
    $db = connectDb();
    if (@pg_query_params($db,
        'UPDATE public.mobile_session SET revoked_at = CURRENT_TIMESTAMP
         WHERE (refresh_hash = $1 OR (previous_refresh_hash = $1
             AND previous_refresh_until > clock_timestamp())) AND revoked_at IS NULL',
        [$refreshHash]) === false) {
        respond(500, ['error' => 'Failed to end mobile session']);
    }
    header('Cache-Control: no-store');
    respond(200, ['message' => 'Logged out']);
}
