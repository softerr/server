CREATE TABLE IF NOT EXISTS public."user" (
    id BIGSERIAL PRIMARY KEY,
    auth_user_id BIGINT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS public.quiz (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    description VARCHAR(1000) NOT NULL DEFAULT '',
    created TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE public.quiz
    ADD COLUMN IF NOT EXISTS description VARCHAR(1000) NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS quiz_user_id_id_idx
    ON public.quiz (user_id, id DESC);

CREATE TABLE IF NOT EXISTS public.question (
    id BIGSERIAL PRIMARY KEY,
    quiz_id BIGINT NOT NULL REFERENCES public.quiz(id) ON DELETE CASCADE,
    template VARCHAR(32) NOT NULL,
    prompt VARCHAR(500) NOT NULL,
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    position INTEGER NOT NULL DEFAULT 0,
    created TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE public.question
    ADD COLUMN IF NOT EXISTS position INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.question
    DROP CONSTRAINT IF EXISTS question_template_check;
ALTER TABLE public.question
    ADD CONSTRAINT question_template_check CHECK (template IN (
        'multiple_choice', 'one_choice', 'number', 'short_answer', 'open',
        'true_false', 'yes_no', 'show_answer', 'no_answer', 'match',
        'ordering', 'fill_blanks', 'categorize'
    ));
DROP INDEX IF EXISTS public.question_quiz_id_id_idx;
CREATE INDEX IF NOT EXISTS question_quiz_id_position_id_idx
    ON public.question (quiz_id, position, id);

GRANT CONNECT ON DATABASE quiz TO auth_api;
GRANT USAGE ON SCHEMA public TO auth_api;
GRANT SELECT, INSERT, DELETE ON TABLE public."user" TO auth_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.quiz TO auth_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.question TO auth_api;
GRANT USAGE, SELECT ON SEQUENCE public.user_id_seq TO auth_api;
GRANT USAGE, SELECT ON SEQUENCE public.quiz_id_seq TO auth_api;
GRANT USAGE, SELECT ON SEQUENCE public.question_id_seq TO auth_api;
