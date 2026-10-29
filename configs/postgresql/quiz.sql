CREATE TABLE IF NOT EXISTS public."user" (
    id BIGSERIAL PRIMARY KEY,
    auth_user_id BIGINT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS public.quiz (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    description VARCHAR(1000) NOT NULL DEFAULT '',
    play_style VARCHAR(16) NOT NULL DEFAULT 'basic'
        CONSTRAINT quiz_play_style_check CHECK (play_style IN ('basic', 'game_show')),
    show_correct_answers BOOLEAN NOT NULL DEFAULT FALSE,
    is_public BOOLEAN NOT NULL DEFAULT FALSE,
    allow_go_back BOOLEAN NOT NULL DEFAULT TRUE,
    randomize_questions BOOLEAN NOT NULL DEFAULT FALSE,
    randomize_answers BOOLEAN NOT NULL DEFAULT FALSE,
    question_limit INTEGER
        CONSTRAINT quiz_question_limit_check CHECK (question_limit BETWEEN 0 AND 1000),
    time_limit_seconds INTEGER CHECK (time_limit_seconds BETWEEN 1 AND 86400),
    created TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS quiz_user_id_id_idx
    ON public.quiz (user_id, id DESC);
CREATE TABLE IF NOT EXISTS public.question (
    id BIGSERIAL PRIMARY KEY,
    quiz_id BIGINT NOT NULL REFERENCES public.quiz(id) ON DELETE CASCADE,
    template VARCHAR(32) NOT NULL CONSTRAINT question_template_check CHECK (template IN (
        'multiple_choice', 'one_choice', 'number', 'short_answer', 'open',
        'true_false', 'yes_no', 'show_answer', 'no_answer', 'match',
        'ordering', 'fill_blanks', 'categorize'
    )),
    prompt VARCHAR(500) NOT NULL,
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    time_limit_seconds INTEGER CHECK (time_limit_seconds BETWEEN 1 AND 86400),
    position INTEGER NOT NULL DEFAULT 0,
    created TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS question_quiz_id_position_id_idx
    ON public.question (quiz_id, position, id);

CREATE TABLE IF NOT EXISTS public.quiz_attempt (
    id BIGSERIAL PRIMARY KEY,
    quiz_id BIGINT NOT NULL REFERENCES public.quiz(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
    play_style VARCHAR(16) NOT NULL DEFAULT 'basic'
        CONSTRAINT quiz_attempt_play_style_check CHECK (play_style IN ('basic', 'game_show')),
    allow_go_back BOOLEAN NOT NULL DEFAULT TRUE,
    furthest_position INTEGER NOT NULL DEFAULT 0,
    randomize_questions BOOLEAN NOT NULL DEFAULT FALSE,
    randomize_answers BOOLEAN NOT NULL DEFAULT FALSE,
    question_limit INTEGER CHECK (question_limit BETWEEN 0 AND 1000),
    time_limit_seconds INTEGER CHECK (time_limit_seconds BETWEEN 1 AND 86400),
    deadline_at TIMESTAMPTZ,
    created TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS quiz_attempt_active_idx
    ON public.quiz_attempt (quiz_id, user_id) WHERE completed IS NULL;
CREATE INDEX IF NOT EXISTS quiz_attempt_user_quiz_idx
    ON public.quiz_attempt (user_id, quiz_id, id DESC);
CREATE INDEX IF NOT EXISTS quiz_attempt_quiz_id_idx
    ON public.quiz_attempt (quiz_id, id DESC);

CREATE TABLE IF NOT EXISTS public.quiz_attempt_source (
    attempt_id BIGINT NOT NULL REFERENCES public.quiz_attempt(id) ON DELETE CASCADE,
    question_id BIGINT NOT NULL,
    position INTEGER NOT NULL,
    template VARCHAR(32) NOT NULL,
    prompt VARCHAR(500) NOT NULL,
    config JSONB NOT NULL,
    time_limit_seconds INTEGER CHECK (time_limit_seconds BETWEEN 1 AND 86400),
    PRIMARY KEY (attempt_id, question_id)
);

CREATE TABLE IF NOT EXISTS public.quiz_attempt_question (
    id BIGSERIAL PRIMARY KEY,
    attempt_id BIGINT NOT NULL REFERENCES public.quiz_attempt(id) ON DELETE CASCADE,
    source_question_id BIGINT NOT NULL,
    position INTEGER NOT NULL,
    started_at TIMESTAMPTZ,
    UNIQUE (attempt_id, id),
    UNIQUE (attempt_id, position),
    FOREIGN KEY (attempt_id, source_question_id)
        REFERENCES public.quiz_attempt_source(attempt_id, question_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS quiz_attempt_question_order_idx
    ON public.quiz_attempt_question (attempt_id, position);

CREATE TABLE IF NOT EXISTS public.quiz_answer (
    attempt_id BIGINT NOT NULL REFERENCES public.quiz_attempt(id) ON DELETE CASCADE,
    question_id BIGINT NOT NULL,
    answer JSONB NOT NULL,
    updated TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (attempt_id, question_id),
    CONSTRAINT quiz_answer_attempt_question_fkey
        FOREIGN KEY (attempt_id, question_id)
        REFERENCES public.quiz_attempt_question(attempt_id, id) ON DELETE CASCADE
);

-- Upgrade the previously deployed quiz schema before the API readiness check.
ALTER TABLE public.quiz ADD COLUMN IF NOT EXISTS time_limit_seconds INTEGER
    CHECK (time_limit_seconds BETWEEN 1 AND 86400);
ALTER TABLE public.quiz ADD COLUMN IF NOT EXISTS allow_go_back BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE public.quiz ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.quiz ADD COLUMN IF NOT EXISTS randomize_answers BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS quiz_public_id_idx
    ON public.quiz (id DESC) WHERE is_public = TRUE;
ALTER TABLE public.question ADD COLUMN IF NOT EXISTS time_limit_seconds INTEGER
    CHECK (time_limit_seconds BETWEEN 1 AND 86400);
ALTER TABLE public.quiz_attempt ADD COLUMN IF NOT EXISTS time_limit_seconds INTEGER
    CHECK (time_limit_seconds BETWEEN 1 AND 86400);
ALTER TABLE public.quiz_attempt ADD COLUMN IF NOT EXISTS allow_go_back BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE public.quiz_attempt ADD COLUMN IF NOT EXISTS randomize_answers BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.quiz_attempt ADD COLUMN IF NOT EXISTS furthest_position INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.quiz_attempt ADD COLUMN IF NOT EXISTS deadline_at TIMESTAMPTZ;
ALTER TABLE public.quiz_attempt_source ADD COLUMN IF NOT EXISTS time_limit_seconds INTEGER
    CHECK (time_limit_seconds BETWEEN 1 AND 86400);
ALTER TABLE public.quiz_attempt_question ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;

GRANT CONNECT ON DATABASE quiz TO auth_api;
GRANT USAGE ON SCHEMA public TO auth_api;
GRANT SELECT, INSERT, DELETE ON TABLE public."user" TO auth_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.quiz TO auth_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.question TO auth_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.quiz_attempt TO auth_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.quiz_attempt_source TO auth_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.quiz_attempt_question TO auth_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.quiz_answer TO auth_api;
GRANT USAGE, SELECT ON SEQUENCE public.user_id_seq TO auth_api;
GRANT USAGE, SELECT ON SEQUENCE public.quiz_id_seq TO auth_api;
GRANT USAGE, SELECT ON SEQUENCE public.question_id_seq TO auth_api;
GRANT USAGE, SELECT ON SEQUENCE public.quiz_attempt_id_seq TO auth_api;
GRANT USAGE, SELECT ON SEQUENCE public.quiz_attempt_question_id_seq TO auth_api;
