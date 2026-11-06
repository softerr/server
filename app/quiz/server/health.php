<?php
declare(strict_types=1);

return static function (): void {
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

};
