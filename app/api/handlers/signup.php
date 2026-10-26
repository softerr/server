<?php
declare(strict_types=1);

function handleSignup(): never
{
    $payload = readJsonBody();
    if ($payload === null) {
        respond(400, ['error' => 'Invalid JSON body']);
    }

    if (!is_string($payload['username'] ?? null)
        || !is_string($payload['password'] ?? null)
        || !is_string($payload['email'] ?? null)) {
        respond(400, ['error' => 'username, password and email are required']);
    }

    $username = trim($payload['username']);
    $password = $payload['password'];
    $email = strtolower(trim($payload['email']));
    $timezone = detectUserTimezone($payload);

    if ($username === '' || $password === '' || $email === '') {
        respond(400, ['error' => 'username, password and email are required']);
    }
    if (strlen($username) > 100) {
        respond(400, ['error' => 'username must be at most 100 characters']);
    }
    if (strlen($password) > 1024) {
        respond(400, ['error' => 'password must be at most 1024 bytes']);
    }
    if (strlen($email) > 255) {
        respond(400, ['error' => 'email must be at most 255 characters']);
    }
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        respond(400, ['error' => 'email is invalid']);
    }
    if (appBaseUrl() === null) {
        respond(503, ['error' => 'Verification email is not configured']);
    }

    $db = connectDb();

    $duplicateCheckResult = @pg_query_params(
        $db,
        'SELECT 1
         FROM public."user"
         WHERE username = $1 OR email = $2
         LIMIT 1',
        [$username, $email]
    );
    if ($duplicateCheckResult === false) {
        respond(500, ['error' => 'Failed to validate account uniqueness']);
    }
    if (pg_fetch_assoc($duplicateCheckResult) !== false) {
        respond(409, ['error' => 'username or email already exists']);
    }

    $passwordHash = password_hash($password, PASSWORD_DEFAULT);
    if ($passwordHash === false) {
        respond(500, ['error' => 'Failed to hash password']);
    }

    if (@pg_query($db, 'BEGIN') === false) {
        respond(500, ['error' => 'Failed to start transaction']);
    }

    $result = @pg_query_params(
        $db,
        'INSERT INTO public."user" (username, password, email)
         VALUES ($1, $2, $3)
         RETURNING id, username, email, verified, created',
        [$username, $passwordHash, $email]
    );

    if ($result === false) {
        @pg_query($db, 'ROLLBACK');
        $errorMessage = pg_last_error($db);
        $normalizedError = strtolower($errorMessage);
        if (
            strpos($normalizedError, 'duplicate key value') !== false
            || strpos($normalizedError, 'unique constraint') !== false
            || strpos($normalizedError, '23505') !== false
        ) {
            respond(409, ['error' => 'username or email already exists']);
        }
        respond(500, ['error' => 'Failed to create account']);
    }

    $user = pg_fetch_assoc($result);
    if ($user === false) {
        @pg_query($db, 'ROLLBACK');
        respond(500, ['error' => 'Failed to fetch created account']);
    }

    $tokenResult = @pg_query_params(
        $db,
        'INSERT INTO public.user_token (user_id, type, email_attempted_at)
         VALUES ($1, $2, CURRENT_TIMESTAMP)
         RETURNING id',
        [$user['id'], 'verify']
    );
    if ($tokenResult === false) {
        @pg_query($db, 'ROLLBACK');
        respond(500, ['error' => 'Failed to create verification token']);
    }

    $tokenRow = pg_fetch_assoc($tokenResult);
    if ($tokenRow === false) {
        @pg_query($db, 'ROLLBACK');
        respond(500, ['error' => 'Failed to fetch verification token']);
    }

    $queueResult = @pg_query_params(
        $db,
        'INSERT INTO public.verification_email_outbox (token_id, timezone) VALUES ($1, $2)',
        [$tokenRow['id'], $timezone]
    );
    if ($queueResult === false) {
        @pg_query($db, 'ROLLBACK');
        respond(500, ['error' => 'Failed to queue verification email']);
    }

    if (@pg_query($db, 'COMMIT') === false) {
        @pg_query($db, 'ROLLBACK');
        respond(500, ['error' => 'Failed to finalize account creation']);
    }

    respond(201, [
        'id' => (int)$user['id'],
        'username' => $user['username'],
        'email' => $user['email'],
        'verified' => $user['verified'] === 't',
        'created' => $user['created'],
        'verification_email_queued' => true,
    ]);
}
