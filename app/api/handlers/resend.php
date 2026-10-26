<?php
declare(strict_types=1);

function handleResendVerification(): never
{
    $rawBody = file_get_contents('php://input', false, null, 0, 4097);
    if ($rawBody === false || strlen($rawBody) > 4096) {
        respond(413, ['error' => 'Request body is too large']);
    }
    $payload = json_decode($rawBody ?: '', true);
    if (!is_array($payload) || !is_string($payload['email'] ?? null)) {
        respond(400, ['error' => 'A valid email is required']);
    }

    $email = strtolower(trim($payload['email']));
    if (strlen($email) > 255) {
        respond(400, ['error' => 'email must be at most 255 characters']);
    }
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        respond(400, ['error' => 'A valid email is required']);
    }
    if (appBaseUrl() === null) {
        respond(503, ['error' => 'Verification email is not configured']);
    }
    $timezone = detectUserTimezone($payload);
    $accepted = ['message' => 'Verification email request accepted'];
    $db = connectDb();

    if (@pg_query($db, 'BEGIN') === false) {
        respond(500, ['error' => 'Failed to start transaction']);
    }

    $userResult = @pg_query_params(
        $db,
        'SELECT id, username, email, verified FROM public."user" WHERE email = $1 FOR UPDATE',
        [$email]
    );
    if ($userResult === false) {
        @pg_query($db, 'ROLLBACK');
        respond(500, ['error' => 'Failed to look up account']);
    }

    $user = pg_fetch_assoc($userResult);
    if ($user === false || $user['verified'] === 't') {
        if (@pg_query($db, 'COMMIT') === false) {
            respond(500, ['error' => 'Failed to finalize verification email request']);
        }
        respond(202, $accepted);
    }

    $tokenResult = @pg_query_params(
        $db,
        'SELECT id, expires,
                expires > CURRENT_TIMESTAMP + INTERVAL \'10 minutes\' AS reusable,
                email_attempted_at > CURRENT_TIMESTAMP - INTERVAL \'1 minute\' AS recent_attempt
         FROM public.user_token
         WHERE user_id = $1 AND type = $2
         ORDER BY id DESC LIMIT 1',
        [$user['id'], 'verify']
    );
    if ($tokenResult === false) {
        @pg_query($db, 'ROLLBACK');
        respond(500, ['error' => 'Failed to look up verification token']);
    }

    $token = pg_fetch_assoc($tokenResult);
    if ($token !== false && $token['recent_attempt'] === 't') {
        if (@pg_query($db, 'COMMIT') === false) {
            respond(500, ['error' => 'Failed to finalize verification email request']);
        }
        respond(202, $accepted);
    }

    if ($token !== false && $token['reusable'] === 't') {
        $claimResult = @pg_query_params(
            $db,
            'UPDATE public.user_token SET email_attempted_at = CURRENT_TIMESTAMP
             WHERE id = $1 RETURNING id',
            [$token['id']]
        );
    } else {
        $deleteResult = @pg_query_params(
            $db,
            'DELETE FROM public.user_token WHERE user_id = $1 AND type = $2',
            [$user['id'], 'verify']
        );
        if ($deleteResult === false) {
            @pg_query($db, 'ROLLBACK');
            respond(500, ['error' => 'Failed to replace verification token']);
        }
        $claimResult = @pg_query_params(
            $db,
            'INSERT INTO public.user_token (user_id, type, email_attempted_at)
             VALUES ($1, $2, CURRENT_TIMESTAMP) RETURNING id',
            [$user['id'], 'verify']
        );
    }
    if ($claimResult === false || ($claimedToken = pg_fetch_assoc($claimResult)) === false) {
        @pg_query($db, 'ROLLBACK');
        respond(500, ['error' => 'Failed to prepare verification email']);
    }

    // A resend schedules the job now, but an active delivery claim stays in place.
    // That delivery can satisfy this request without creating a second send.
    $queueResult = @pg_query_params(
        $db,
        'INSERT INTO public.verification_email_outbox (token_id, timezone)
         VALUES ($1, $2)
         ON CONFLICT (token_id) DO UPDATE
         SET timezone = EXCLUDED.timezone, available_at = CURRENT_TIMESTAMP, attempts = 0',
        [$claimedToken['id'], $timezone]
    );
    if ($queueResult === false) {
        @pg_query($db, 'ROLLBACK');
        respond(500, ['error' => 'Failed to queue verification email']);
    }

    if (@pg_query($db, 'COMMIT') === false) {
        @pg_query($db, 'ROLLBACK');
        respond(500, ['error' => 'Failed to finalize verification email request']);
    }

    respond(202, $accepted);
}
