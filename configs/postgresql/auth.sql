CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public."user" (
    id BIGSERIAL PRIMARY KEY,
    username VARCHAR(100) NOT NULL UNIQUE,
    password TEXT NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    role VARCHAR(16) NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'mod', 'user')),
    deleting BOOLEAN NOT NULL DEFAULT FALSE,
    verified BOOLEAN NOT NULL DEFAULT FALSE,
    approved_at TIMESTAMP,
    approved_by BIGINT REFERENCES public."user"(id) ON DELETE SET NULL,
    created TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Existing verified accounts predate approval and must retain access. This
-- runs only when upgrading the old schema, never for new accounts.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'user'
                     AND column_name = 'approved_at') THEN
        ALTER TABLE public."user" ADD COLUMN approved_at TIMESTAMP;
        UPDATE public."user" SET approved_at = CURRENT_TIMESTAMP WHERE verified = TRUE;
    END IF;
END $$;
ALTER TABLE public."user" ADD COLUMN IF NOT EXISTS approved_by BIGINT
    REFERENCES public."user"(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.user_token (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
    type VARCHAR(64) NOT NULL,
    hash TEXT NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
    expires TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '1 hour'),
    email_attempted_at TIMESTAMP
);

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
GRANT INSERT (username, password, email) ON TABLE public."user" TO auth_api;
GRANT UPDATE (password, verified, role, deleting, approved_at, approved_by) ON TABLE public."user" TO auth_api;
GRANT DELETE ON TABLE public."user" TO auth_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_token TO auth_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.verification_email_outbox TO auth_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.approval_email_outbox TO auth_api;
GRANT USAGE, SELECT ON SEQUENCE public.user_id_seq TO auth_api;
GRANT USAGE, SELECT ON SEQUENCE public.user_token_id_seq TO auth_api;
GRANT USAGE, SELECT ON SEQUENCE public.verification_email_outbox_id_seq TO auth_api;
GRANT USAGE, SELECT ON SEQUENCE public.approval_email_outbox_id_seq TO auth_api;
