<?php
declare(strict_types=1);

function handleVerify(): never
{
    $token = trim((string)($_GET['token'] ?? ''));
    if ($token === '' || !preg_match('/^[a-f0-9]{64}$/i', $token)) {
        respond(400, ['error' => 'Invalid verification token']);
    }

    $db = connectDb();

    $lookupResult = @pg_query_params(
        $db,
        'SELECT id, user_id
         FROM public.user_token
         WHERE hash = $1
           AND type = $2
           AND expires > CURRENT_TIMESTAMP
         LIMIT 1',
        [$token, 'verify']
    );
    if ($lookupResult === false) {
        respond(500, ['error' => 'Failed to validate verification token']);
    }

    $candidate = pg_fetch_assoc($lookupResult);
    if ($candidate === false) {
        respond(400, ['error' => 'Verification token is invalid or expired']);
    }

    if (@pg_query($db, 'BEGIN') === false) {
        respond(500, ['error' => 'Failed to start transaction']);
    }

    $accountLock = @pg_query_params(
        $db,
        'SELECT id FROM public."user" WHERE id = $1 FOR UPDATE',
        [$candidate['user_id']]
    );
    if ($accountLock === false) {
        @pg_query($db, 'ROLLBACK');
        respond(500, ['error' => 'Failed to lock account for verification']);
    }
    if (pg_fetch_assoc($accountLock) === false) {
        @pg_query($db, 'ROLLBACK');
        respond(400, ['error' => 'Verification token is invalid or expired']);
    }

    // Resend holds the same account lock before replacing tokens. Check again
    // after acquiring it, and lock the token against concurrent pruning.
    $tokenResult = @pg_query_params(
        $db,
        'SELECT id FROM public.user_token
         WHERE id = $1 AND user_id = $2 AND hash = $3
           AND type = $4 AND expires > clock_timestamp()
         FOR UPDATE',
        [$candidate['id'], $candidate['user_id'], $token, 'verify']
    );
    if ($tokenResult === false) {
        @pg_query($db, 'ROLLBACK');
        respond(500, ['error' => 'Failed to validate verification token']);
    }
    if (pg_fetch_assoc($tokenResult) === false) {
        @pg_query($db, 'ROLLBACK');
        respond(400, ['error' => 'Verification token is invalid or expired']);
    }

    $verifyResult = @pg_query_params(
        $db,
        'UPDATE public."user"
         SET verified = TRUE
         WHERE id = $1
         RETURNING id, username, email, verified, created',
        [$candidate['user_id']]
    );
    if ($verifyResult === false) {
        @pg_query($db, 'ROLLBACK');
        respond(500, ['error' => 'Failed to verify account']);
    }

    $user = pg_fetch_assoc($verifyResult);
    if ($user === false) {
        @pg_query($db, 'ROLLBACK');
        respond(500, ['error' => 'Failed to fetch verified account']);
    }

    $deleteResult = @pg_query_params(
        $db,
        'DELETE FROM public.user_token WHERE user_id = $1 AND type = $2',
        [$candidate['user_id'], 'verify']
    );
    if ($deleteResult === false) {
        @pg_query($db, 'ROLLBACK');
        respond(500, ['error' => 'Failed to finalize verification']);
    }

    if (@pg_query($db, 'COMMIT') === false) {
        @pg_query($db, 'ROLLBACK');
        respond(500, ['error' => 'Failed to commit verification']);
    }

    respond(200, [
        'id' => (int)$user['id'],
        'username' => $user['username'],
        'email' => $user['email'],
        'verified' => $user['verified'] === 't',
        'created' => $user['created'],
    ]);
}
