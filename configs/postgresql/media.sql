CREATE TABLE IF NOT EXISTS public.image_blob (
    id BIGSERIAL PRIMARY KEY,
    sha256 CHAR(64) NOT NULL UNIQUE,
    mime_type VARCHAR(16) NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp')),
    width INTEGER NOT NULL CHECK (width BETWEEN 1 AND 4096),
    height INTEGER NOT NULL CHECK (height BETWEEN 1 AND 4096),
    content BYTEA NOT NULL CONSTRAINT image_blob_content_size_check
        CHECK (octet_length(content) BETWEEN 1 AND 6291456)
);

CREATE TABLE IF NOT EXISTS public.media_group (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    created TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS media_group_name_idx ON public.media_group (lower(name));

CREATE TABLE IF NOT EXISTS public.image (
    id BIGSERIAL PRIMARY KEY,
    blob_id BIGINT NOT NULL REFERENCES public.image_blob(id),
    owner_auth_user_id BIGINT,
    uploaded_by_auth_user_id BIGINT,
    group_id BIGINT REFERENCES public.media_group(id) ON DELETE SET NULL,
    shared BOOLEAN NOT NULL DEFAULT FALSE,
    original_name VARCHAR(255) NOT NULL,
    created TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK ((owner_auth_user_id IS NULL) = shared),
    CONSTRAINT image_group_shared_check CHECK (group_id IS NULL OR shared = TRUE),
    UNIQUE (owner_auth_user_id, blob_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS image_shared_blob_idx
    ON public.image (blob_id) WHERE shared = TRUE;
CREATE INDEX IF NOT EXISTS image_owner_id_idx
    ON public.image (owner_auth_user_id, id DESC);
CREATE INDEX IF NOT EXISTS image_uploaded_by_id_idx
    ON public.image (uploaded_by_auth_user_id, id DESC);
CREATE INDEX IF NOT EXISTS image_group_id_idx
    ON public.image (group_id, id) WHERE shared = TRUE;
CREATE INDEX IF NOT EXISTS image_shared_name_idx
    ON public.image (lower(original_name), id) WHERE shared = TRUE;

-- Media is committed before the quiz transaction. Keep a durable record so a
-- failed or interrupted import can remove only images created by that import.
CREATE TABLE IF NOT EXISTS public.quiz_import_recovery (
    id CHAR(32) PRIMARY KEY,
    owner_auth_user_id BIGINT NOT NULL,
    quiz_id BIGINT NOT NULL,
    image_ids JSONB NOT NULL CHECK (jsonb_typeof(image_ids) = 'array'),
    created TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS quiz_import_recovery_created_idx
    ON public.quiz_import_recovery (created);

GRANT CONNECT ON DATABASE media TO auth_api;
GRANT USAGE ON SCHEMA public TO auth_api;
GRANT SELECT, INSERT, DELETE ON TABLE public.image_blob TO auth_api;
GRANT SELECT, INSERT, DELETE ON TABLE public.image TO auth_api;
GRANT UPDATE (owner_auth_user_id, shared, group_id, original_name) ON TABLE public.image TO auth_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.media_group TO auth_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.quiz_import_recovery TO auth_api;
GRANT USAGE, SELECT ON SEQUENCE public.image_blob_id_seq TO auth_api;
GRANT USAGE, SELECT ON SEQUENCE public.image_id_seq TO auth_api;
GRANT USAGE, SELECT ON SEQUENCE public.media_group_id_seq TO auth_api;
