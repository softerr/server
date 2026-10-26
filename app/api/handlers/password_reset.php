<?php
declare(strict_types=1);

function handlePasswordResetRequest(): never
{
    $payload = readJsonBody();
    if ($payload === null || !is_string($payload['email'] ?? null)) {
        respond(400, ['error' => 'A valid email is required']);
    }
    $email = strtolower(trim($payload['email']));
    if (strlen($email) > 255 || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        respond(400, ['error' => 'A valid email is required']);
    }
    if (appBaseUrl() === null) {
        respond(503, ['error' => 'Password reset email is not configured']);
    }

    $accepted = ['message' => 'If this account exists, a password reset email will be sent'];
    $db = connectDb();
    if (@pg_query($db, 'BEGIN') === false) {
        respond(500, ['error' => 'Failed to start transaction']);
    }
    $result = @pg_query_params(
        $db,
        'SELECT id, verified FROM public."user" WHERE email = $1 FOR UPDATE',
        [$email]
    );
    if ($result === false) {
        @pg_query($db, 'ROLLBACK');
        respond(500, ['error' => 'Failed to look up account']);
    }
    $user = pg_fetch_assoc($result);
    if ($user !== false && $user['verified'] === 't') {
        $recent = @pg_query_params(
            $db,
            'SELECT 1 FROM public.user_token
             WHERE user_id = $1 AND type = $2
               AND email_attempted_at > CURRENT_TIMESTAMP - INTERVAL \'10 minutes\'
             LIMIT 1',
            [$user['id'], 'password_reset']
        );
        if ($recent === false) {
            @pg_query($db, 'ROLLBACK');
            respond(500, ['error' => 'Failed to check password reset cooldown']);
        }
        if (pg_fetch_assoc($recent) === false) {
            $deleted = @pg_query_params(
                $db,
                'DELETE FROM public.user_token WHERE user_id = $1 AND type = $2',
                [$user['id'], 'password_reset']
            );
            if ($deleted === false) {
                @pg_query($db, 'ROLLBACK');
                respond(500, ['error' => 'Failed to replace password reset token']);
            }
            $token = @pg_query_params(
                $db,
                'INSERT INTO public.user_token (user_id, type, expires, email_attempted_at)
                 VALUES ($1, $2, CURRENT_TIMESTAMP + INTERVAL \'30 minutes\', CURRENT_TIMESTAMP)
                 RETURNING id',
                [$user['id'], 'password_reset']
            );
            $tokenRow = $token === false ? false : pg_fetch_assoc($token);
            if ($tokenRow === false) {
                @pg_query($db, 'ROLLBACK');
                respond(500, ['error' => 'Failed to create password reset token']);
            }
            $queued = @pg_query_params(
                $db,
                'INSERT INTO public.verification_email_outbox (token_id) VALUES ($1)',
                [$tokenRow['id']]
            );
            if ($queued === false) {
                @pg_query($db, 'ROLLBACK');
                respond(500, ['error' => 'Failed to queue password reset email']);
            }
        }
    }
    if (@pg_query($db, 'COMMIT') === false) {
        @pg_query($db, 'ROLLBACK');
        respond(500, ['error' => 'Failed to finalize password reset request']);
    }
    respond(202, $accepted);
}

function handlePasswordResetConfirm(): never
{
    $payload = readJsonBody();
    if ($payload === null || !is_string($payload['token'] ?? null)
        || !is_string($payload['password'] ?? null)) {
        respond(400, ['error' => 'token and password are required']);
    }
    $token = $payload['token'];
    $password = $payload['password'];
    if (!preg_match('/^[a-f0-9]{64}$/i', $token)) {
        respond(400, ['error' => 'Invalid or expired password reset link']);
    }
    if ($password === '' || strlen($password) > 1024) {
        respond(400, ['error' => 'password must be 1 to 1024 bytes']);
    }

    $tokenHash = hash('sha256', hex2bin($token));
    $db = connectDb();
    $lookup = @pg_query_params(
        $db,
        'SELECT id, user_id FROM public.user_token
         WHERE hash = $1 AND type = $2 AND expires > CURRENT_TIMESTAMP LIMIT 1',
        [$tokenHash, 'password_reset']
    );
    if ($lookup === false) {
        respond(500, ['error' => 'Failed to validate password reset link']);
    }
    $candidate = pg_fetch_assoc($lookup);
    if ($candidate === false) {
        respond(400, ['error' => 'Invalid or expired password reset link']);
    }
    $passwordHash = password_hash($password, PASSWORD_DEFAULT);
    if ($passwordHash === false) {
        respond(500, ['error' => 'Failed to hash password']);
    }
    if (@pg_query($db, 'BEGIN') === false) {
        respond(500, ['error' => 'Failed to start transaction']);
    }
    $account = @pg_query_params(
        $db,
        'SELECT id FROM public."user" WHERE id = $1 FOR UPDATE',
        [$candidate['user_id']]
    );
    if ($account === false) {
        @pg_query($db, 'ROLLBACK');
        respond(500, ['error' => 'Failed to lock account']);
    }
    if (pg_fetch_assoc($account) === false) {
        @pg_query($db, 'ROLLBACK');
        respond(400, ['error' => 'Invalid or expired password reset link']);
    }
    $checked = @pg_query_params(
        $db,
        'SELECT id FROM public.user_token
         WHERE id = $1 AND user_id = $2 AND hash = $3
           AND type = $4 AND expires > clock_timestamp()
         FOR UPDATE',
        [$candidate['id'], $candidate['user_id'], $tokenHash, 'password_reset']
    );
    if ($checked === false) {
        @pg_query($db, 'ROLLBACK');
        respond(500, ['error' => 'Failed to validate password reset link']);
    }
    if (pg_fetch_assoc($checked) === false) {
        @pg_query($db, 'ROLLBACK');
        respond(400, ['error' => 'Invalid or expired password reset link']);
    }
    $updated = @pg_query_params(
        $db,
        'UPDATE public."user" SET password = $1 WHERE id = $2',
        [$passwordHash, $candidate['user_id']]
    );
    $deleted = @pg_query_params(
        $db,
        'DELETE FROM public.user_token WHERE user_id = $1 AND type = $2',
        [$candidate['user_id'], 'password_reset']
    );
    $notice = @pg_query_params(
        $db,
        'INSERT INTO public.user_token (user_id, type, expires)
         VALUES ($1, $2, CURRENT_TIMESTAMP + INTERVAL \'1 day\') RETURNING id',
        [$candidate['user_id'], 'password_changed']
    );
    $noticeRow = $notice === false ? false : pg_fetch_assoc($notice);
    $queued = $noticeRow === false ? false : @pg_query_params(
        $db,
        'INSERT INTO public.verification_email_outbox (token_id) VALUES ($1)',
        [$noticeRow['id']]
    );
    if ($updated === false || $deleted === false || $noticeRow === false || $queued === false) {
        @pg_query($db, 'ROLLBACK');
        respond(500, ['error' => 'Failed to update password']);
    }
    if (@pg_query($db, 'COMMIT') === false) {
        @pg_query($db, 'ROLLBACK');
        respond(500, ['error' => 'Failed to finalize password reset']);
    }
    respond(200, ['message' => 'Password updated. Please log in.']);
}
