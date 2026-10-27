<?php
declare(strict_types=1);

function handleReadiness(): never
{
    if (!class_exists(ZipArchive::class)) {
        respond(503, ['status' => 'unavailable', 'error' => 'ZIP support is not ready']);
    }
    if (appBaseUrl() === null) {
        respond(503, ['status' => 'unavailable', 'error' => 'Verification email is not configured']);
    }

    [$db, $error] = openDb();
    if ($db === false) {
        respond(503, ['status' => 'unavailable', 'error' => $error]);
    }

    $schema = @pg_query($db, 'SELECT u.id, u.email, u.role, u.deleting, u.approved_at, u.approved_by,
            t.hash, t.email_attempted_at, o.token_id, o.available_at, o.claimed_until, o.claim_id,
            a.applicant_id, a.recipient_id, a.available_at, a.claim_id
        FROM public."user" u, public.user_token t, public.verification_email_outbox o,
             public.approval_email_outbox a
        LIMIT 0');
    if ($schema === false) {
        respond(503, ['status' => 'unavailable', 'error' => 'Database schema is not ready']);
    }

    [$quizDb, $quizError] = openQuizDb();
    if ($quizDb === false) {
        respond(503, ['status' => 'unavailable', 'error' => $quizError]);
    }
    $quizSchema = @pg_query($quizDb, 'SELECT q.id, q.user_id, q.name, q.description,
            u.auth_user_id, t.id, t.quiz_id, t.template, t.prompt, t.config,
            i.id, i.user_id, i.original_name, i.mime_type, i.content
        FROM public.quiz q, public."user" u, public.question t, public.image i LIMIT 0');
    if ($quizSchema === false) {
        respond(503, ['status' => 'unavailable', 'error' => 'Quiz database schema is not ready']);
    }
    $quizOwnerConstraint = @pg_query($quizDb, "SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.quiz'::regclass AND conname = 'quiz_user_id_fkey'");
    if ($quizOwnerConstraint === false || pg_num_rows($quizOwnerConstraint) !== 1) {
        respond(503, ['status' => 'unavailable', 'error' => 'Quiz database schema is not ready']);
    }

    respond(200, ['status' => 'ok', 'message' => 'API is ready']);
}
