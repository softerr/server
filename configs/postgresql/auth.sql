CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public."user" (
    id BIGSERIAL PRIMARY KEY,
    username VARCHAR(100) NOT NULL UNIQUE,
    password TEXT,
    email VARCHAR(255) UNIQUE,
    account_kind VARCHAR(16) NOT NULL DEFAULT 'human' CHECK (account_kind IN ('human', 'service')),
    service_owner_id BIGINT REFERENCES public."user"(id) ON DELETE CASCADE,
    display_name VARCHAR(100),
    role VARCHAR(16) NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'mod', 'user')),
    deleting BOOLEAN NOT NULL DEFAULT FALSE,
    verified BOOLEAN NOT NULL DEFAULT FALSE,
    approved_at TIMESTAMP,
    approved_by BIGINT REFERENCES public."user"(id) ON DELETE SET NULL,
    created TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT user_account_credentials_check
        CHECK ((account_kind = 'human' AND password IS NOT NULL AND email IS NOT NULL
            AND service_owner_id IS NULL AND display_name IS NULL)
            OR (account_kind = 'service' AND password IS NULL AND email IS NULL
            AND service_owner_id IS NOT NULL AND display_name IS NOT NULL AND role = 'user'))
);

CREATE TABLE IF NOT EXISTS public.user_token (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
    type VARCHAR(64) NOT NULL,
    hash TEXT NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
    expires TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '1 hour'),
    email_attempted_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.api_token (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
    created_by BIGINT REFERENCES public."user"(id) ON DELETE SET NULL,
    name VARCHAR(100) NOT NULL,
    token_hash CHAR(64) NOT NULL UNIQUE,
    scopes JSONB NOT NULL CHECK (jsonb_typeof(scopes) = 'array'),
    read_owner_quizzes BOOLEAN NOT NULL DEFAULT FALSE,
    edit_owner_quizzes BOOLEAN NOT NULL DEFAULT FALSE,
    quiz_permissions JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(quiz_permissions) = 'object'),
    created TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS api_token_user_id_idx ON public.api_token (user_id, id DESC);

CREATE TABLE IF NOT EXISTS public.api_token_activity (
    id BIGSERIAL PRIMARY KEY,
    token_id BIGINT NOT NULL REFERENCES public.api_token(id) ON DELETE CASCADE,
    method VARCHAR(16) NOT NULL,
    path VARCHAR(512) NOT NULL,
    status INTEGER NOT NULL,
    created TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS api_token_activity_token_id_idx
    ON public.api_token_activity (token_id, id DESC);

CREATE TABLE IF NOT EXISTS public.verification_email_outbox (
    id BIGSERIAL PRIMARY KEY,
    token_id BIGINT NOT NULL UNIQUE REFERENCES public.user_token(id) ON DELETE CASCADE,
    timezone TEXT,
    queued_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    available_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    claimed_until TIMESTAMP,
    claim_id UUID,
    attempts INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.approval_email_outbox (
    id BIGSERIAL PRIMARY KEY,
    applicant_id BIGINT NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
    recipient_id BIGINT NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
    queued_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    available_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    claimed_until TIMESTAMP,
    claim_id UUID,
    attempts INTEGER NOT NULL DEFAULT 0,
    UNIQUE (applicant_id, recipient_id)
);

CREATE INDEX IF NOT EXISTS approval_email_outbox_available_idx
    ON public.approval_email_outbox (available_at, id);

CREATE INDEX IF NOT EXISTS verification_email_outbox_available_idx
    ON public.verification_email_outbox (available_at, id);

CREATE INDEX IF NOT EXISTS user_token_hash_idx
    ON public.user_token (hash);
CREATE INDEX IF NOT EXISTS user_token_user_type_id_idx
    ON public.user_token (user_id, type, id DESC);
CREATE INDEX IF NOT EXISTS user_token_verify_expiry_idx
    ON public.user_token (expires) WHERE type = 'verify';

GRANT CONNECT ON DATABASE auth TO auth_api;
GRANT USAGE ON SCHEMA public TO auth_api;
REVOKE INSERT, UPDATE ON TABLE public."user" FROM auth_api;
GRANT SELECT ON TABLE public."user" TO auth_api;
GRANT INSERT (username, password, email, account_kind, service_owner_id, display_name, verified, approved_at) ON TABLE public."user" TO auth_api;
GRANT UPDATE (password, verified, role, deleting, approved_at, approved_by) ON TABLE public."user" TO auth_api;
GRANT DELETE ON TABLE public."user" TO auth_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_token TO auth_api;
GRANT SELECT, INSERT ON TABLE public.api_token TO auth_api;
GRANT UPDATE (last_used_at, revoked_at, read_owner_quizzes, edit_owner_quizzes, quiz_permissions) ON TABLE public.api_token TO auth_api;
GRANT SELECT, INSERT, DELETE ON TABLE public.api_token_activity TO auth_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.verification_email_outbox TO auth_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.approval_email_outbox TO auth_api;
GRANT USAGE, SELECT ON SEQUENCE public.user_id_seq TO auth_api;
GRANT USAGE, SELECT ON SEQUENCE public.user_token_id_seq TO auth_api;
GRANT USAGE, SELECT ON SEQUENCE public.api_token_id_seq TO auth_api;
GRANT USAGE, SELECT ON SEQUENCE public.api_token_activity_id_seq TO auth_api;
GRANT USAGE, SELECT ON SEQUENCE public.verification_email_outbox_id_seq TO auth_api;
GRANT USAGE, SELECT ON SEQUENCE public.approval_email_outbox_id_seq TO auth_api;
