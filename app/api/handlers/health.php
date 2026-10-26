<?php
declare(strict_types=1);

function handleReadiness(): never
{
    if (appBaseUrl() === null) {
        respond(503, ['status' => 'unavailable', 'error' => 'Verification email is not configured']);
    }

    [$db, $error] = openDb();
    if ($db === false) {
        respond(503, ['status' => 'unavailable', 'error' => $error]);
    }

    $schema = @pg_query($db, 'SELECT u.id, u.email, t.hash, t.email_attempted_at,
            o.token_id, o.available_at, o.claimed_until, o.claim_id
        FROM public."user" u, public.user_token t, public.verification_email_outbox o
        LIMIT 0');
    if ($schema === false) {
        respond(503, ['status' => 'unavailable', 'error' => 'Database schema is not ready']);
    }

    respond(200, ['status' => 'ok', 'message' => 'API is ready']);
}
