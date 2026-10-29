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
    $quizSchema = @pg_query($quizDb, 'SELECT q.id, q.user_id, q.name, q.description, q.play_style, q.show_correct_answers, q.is_public, q.allow_go_back, q.randomize_questions, q.randomize_answers, q.question_limit, q.time_limit_seconds,
            u.auth_user_id, t.id, t.quiz_id, t.template, t.prompt, t.config, t.time_limit_seconds,
            a.id, a.quiz_id, a.user_id, a.completed, a.allow_go_back, a.furthest_position, a.randomize_questions, a.randomize_answers, a.question_limit, a.time_limit_seconds, a.deadline_at,
            b.attempt_id, b.question_id, b.position, b.template, b.prompt, b.config, b.time_limit_seconds,
            s.id, s.attempt_id, s.source_question_id, s.position, s.started_at, s.time_spent_ms, r.attempt_id, r.question_id, r.answer
        FROM public.quiz q, public."user" u, public.question t,
             public.quiz_attempt a, public.quiz_attempt_source b,
             public.quiz_attempt_question s, public.quiz_answer r LIMIT 0');
    if ($quizSchema === false) {
        respond(503, ['status' => 'unavailable', 'error' => 'Quiz database schema is not ready']);
    }
    $quizOwnerConstraint = @pg_query($quizDb, "SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.quiz'::regclass AND conname = 'quiz_user_id_fkey'");
    if ($quizOwnerConstraint === false || pg_num_rows($quizOwnerConstraint) !== 1) {
        respond(503, ['status' => 'unavailable', 'error' => 'Quiz database schema is not ready']);
    }
    if (@pg_query($quizDb, 'SELECT id, quiz_id FROM public.quiz_import_receipt LIMIT 0') === false) {
        respond(503, ['status' => 'unavailable', 'error' => 'Quiz database schema is not ready']);
    }

    [$mediaDb, $mediaError] = openMediaDb();
    if ($mediaDb === false) {
        respond(503, ['status' => 'unavailable', 'error' => $mediaError]);
    }
    $mediaSchema = @pg_query($mediaDb, 'SELECT i.id, i.blob_id, i.owner_auth_user_id, i.uploaded_by_auth_user_id, i.group_id,
            i.shared, i.original_name, b.sha256, b.mime_type, b.content
        FROM public.image i, public.image_blob b LIMIT 0');
    if ($mediaSchema === false) {
        respond(503, ['status' => 'unavailable', 'error' => 'Media database schema is not ready']);
    }
    if (@pg_query($mediaDb, 'SELECT id, name FROM public.media_group LIMIT 0') === false) {
        respond(503, ['status' => 'unavailable', 'error' => 'Media database schema is not ready']);
    }
    if (@pg_query($mediaDb, 'SELECT id, quiz_id, image_ids FROM public.quiz_import_recovery LIMIT 0') === false) {
        respond(503, ['status' => 'unavailable', 'error' => 'Media database schema is not ready']);
    }

    respond(200, ['status' => 'ok', 'message' => 'API is ready']);
}
