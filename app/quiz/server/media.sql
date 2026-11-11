CREATE TABLE IF NOT EXISTS public.quiz_import_recovery (
    id CHAR(32) PRIMARY KEY,
    owner_auth_user_id BIGINT NOT NULL,
    quiz_id BIGINT NOT NULL,
    image_ids JSONB NOT NULL CHECK (jsonb_typeof(image_ids) = 'array'),
    created TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS quiz_import_recovery_created_idx
    ON public.quiz_import_recovery (created);
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.quiz_import_recovery TO auth_api;
