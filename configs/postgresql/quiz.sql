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
    position INTEGER NOT NULL DEFAULT 0,
    created TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS question_quiz_id_position_id_idx
    ON public.question (quiz_id, position, id);

CREATE TABLE IF NOT EXISTS public.image (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
    sha256 CHAR(64) NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    mime_type VARCHAR(16) NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp')),
    width INTEGER NOT NULL CHECK (width BETWEEN 1 AND 4096),
    height INTEGER NOT NULL CHECK (height BETWEEN 1 AND 4096),
    content BYTEA NOT NULL CHECK (octet_length(content) BETWEEN 1 AND 2097152),
    created TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, sha256)
);
CREATE INDEX IF NOT EXISTS image_user_id_id_idx ON public.image (user_id, id DESC);

GRANT CONNECT ON DATABASE quiz TO auth_api;
GRANT USAGE ON SCHEMA public TO auth_api;
GRANT SELECT, INSERT, DELETE ON TABLE public."user" TO auth_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.quiz TO auth_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.question TO auth_api;
GRANT SELECT, INSERT, DELETE ON TABLE public.image TO auth_api;
GRANT USAGE, SELECT ON SEQUENCE public.user_id_seq TO auth_api;
GRANT USAGE, SELECT ON SEQUENCE public.quiz_id_seq TO auth_api;
GRANT USAGE, SELECT ON SEQUENCE public.question_id_seq TO auth_api;
GRANT USAGE, SELECT ON SEQUENCE public.image_id_seq TO auth_api;
