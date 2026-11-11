CREATE TABLE IF NOT EXISTS public.image_blob (
    id BIGSERIAL PRIMARY KEY,
    sha256 CHAR(64) NOT NULL UNIQUE,
    mime_type VARCHAR(16) NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp')),
    width INTEGER NOT NULL CHECK (width BETWEEN 1 AND 4096),
    height INTEGER NOT NULL CHECK (height BETWEEN 1 AND 4096),
    size_bytes INTEGER NOT NULL CONSTRAINT image_blob_size_bytes_check
        CHECK (size_bytes BETWEEN 1 AND 6291456),
    thumbnail_mime_type VARCHAR(16)
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

CREATE TABLE IF NOT EXISTS public.api_token_image_access (
    service_auth_user_id BIGINT NOT NULL,
    app VARCHAR(32) NOT NULL,
    resource_id BIGINT NOT NULL DEFAULT 0 CHECK (resource_id >= 0),
    image_id BIGINT NOT NULL REFERENCES public.image(id) ON DELETE CASCADE,
    PRIMARY KEY (service_auth_user_id, app, resource_id, image_id)
);
CREATE INDEX IF NOT EXISTS api_token_image_access_image_idx
    ON public.api_token_image_access (image_id, service_auth_user_id);

CREATE TABLE IF NOT EXISTS public.image_source (
    image_id BIGINT PRIMARY KEY REFERENCES public.image(id) ON DELETE CASCADE,
    source_page TEXT NOT NULL,
    creator TEXT NOT NULL,
    license_name TEXT NOT NULL,
    license_url TEXT,
    attribution TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS public.audio_file (
    id BIGSERIAL PRIMARY KEY,
    owner_auth_user_id BIGINT NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    mime_type VARCHAR(64) NOT NULL CHECK (mime_type IN
        ('audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/flac', 'audio/mp4')),
    size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 25165824),
    sha256 CHAR(64) NOT NULL,
    created TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (owner_auth_user_id, sha256)
);
CREATE INDEX IF NOT EXISTS audio_file_owner_id_idx
    ON public.audio_file (owner_auth_user_id, id DESC);

GRANT CONNECT ON DATABASE media TO auth_api;
GRANT USAGE ON SCHEMA public TO auth_api;
GRANT SELECT, INSERT, DELETE ON TABLE public.image_blob TO auth_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.audio_file TO auth_api;
GRANT UPDATE (thumbnail_mime_type) ON TABLE public.image_blob TO auth_api;
GRANT SELECT, INSERT, DELETE ON TABLE public.image TO auth_api;
GRANT SELECT, INSERT, DELETE ON TABLE public.api_token_image_access TO auth_api;
GRANT UPDATE (owner_auth_user_id, shared, group_id, original_name) ON TABLE public.image TO auth_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.media_group TO auth_api;
GRANT SELECT, INSERT ON TABLE public.image_source TO auth_api;
GRANT USAGE, SELECT ON SEQUENCE public.image_blob_id_seq TO auth_api;
GRANT USAGE, SELECT ON SEQUENCE public.audio_file_id_seq TO auth_api;
GRANT USAGE, SELECT ON SEQUENCE public.image_id_seq TO auth_api;
GRANT USAGE, SELECT ON SEQUENCE public.media_group_id_seq TO auth_api;
