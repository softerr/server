CREATE TABLE IF NOT EXISTS public."user" (
    id BIGSERIAL PRIMARY KEY,
    auth_user_id BIGINT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS public.track (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    artist VARCHAR(200) NOT NULL DEFAULT '',
    media_audio_id BIGINT NOT NULL,
    version BIGINT NOT NULL DEFAULT 1,
    stats_version BIGINT NOT NULL DEFAULT 1,
    album VARCHAR(200) NOT NULL DEFAULT '',
    genre VARCHAR(200) NOT NULL DEFAULT '',
    release_year INTEGER CHECK (release_year BETWEEN 1800 AND 2100),
    track_number INTEGER CHECK (track_number BETWEEN 1 AND 999),
    rating INTEGER CHECK (rating BETWEEN 0 AND 10),
    play_count BIGINT NOT NULL DEFAULT 0,
    listen_ms BIGINT NOT NULL DEFAULT 0,
    art_image_id BIGINT,
    duration_ms BIGINT CHECK (duration_ms BETWEEN 0 AND 86400000),
    bit_rate INTEGER CHECK (bit_rate BETWEEN 1 AND 1000000000),
    sample_rate_hz INTEGER CHECK (sample_rate_hz BETWEEN 1 AND 1000000),
    bit_depth SMALLINT CHECK (bit_depth BETWEEN 1 AND 64),
    channels SMALLINT CHECK (channels BETWEEN 1 AND 64),
    codec VARCHAR(100),
    estimated_bpm SMALLINT CHECK (estimated_bpm BETWEEN 30 AND 300),
    estimated_key VARCHAR(32),
    peak_db NUMERIC(7, 2) CHECK (peak_db BETWEEN -200 AND 20),
    average_db NUMERIC(7, 2) CHECK (average_db BETWEEN -200 AND 20),
    dynamic_range_db NUMERIC(7, 2) CHECK (dynamic_range_db BETWEEN 0 AND 220),
    analysis_saved_at TIMESTAMPTZ,
    created TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS track_user_id_idx ON public.track (user_id, id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS track_user_media_audio_id_idx ON public.track (user_id, media_audio_id);

CREATE TABLE IF NOT EXISTS public.track_upload_request (
    user_id BIGINT NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
    request_id UUID NOT NULL,
    request_sha256 CHAR(64) NOT NULL,
    track_id BIGINT REFERENCES public.track(id) ON DELETE SET NULL,
    created TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, request_id)
);
CREATE INDEX IF NOT EXISTS track_upload_request_created_idx
    ON public.track_upload_request (user_id, created);

CREATE TABLE IF NOT EXISTS public.track_stat_request (
    user_id BIGINT NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
    request_id UUID NOT NULL,
    request_sha256 CHAR(64) NOT NULL,
    track_id BIGINT NOT NULL,
    play_count BIGINT NOT NULL,
    listen_ms BIGINT NOT NULL,
    stats_version BIGINT NOT NULL,
    created TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, request_id)
);

CREATE TABLE IF NOT EXISTS public.playlist (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    version BIGINT NOT NULL DEFAULT 1,
    created TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS playlist_user_id_idx ON public.playlist (user_id, id DESC);

CREATE TABLE IF NOT EXISTS public.playlist_create_request (
    user_id BIGINT NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
    request_id UUID NOT NULL,
    request_name VARCHAR(100) NOT NULL,
    playlist_id BIGINT REFERENCES public.playlist(id) ON DELETE SET NULL,
    created TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, request_id)
);

CREATE TABLE IF NOT EXISTS public.playlist_track (
    playlist_id BIGINT NOT NULL REFERENCES public.playlist(id) ON DELETE CASCADE,
    track_id BIGINT NOT NULL REFERENCES public.track(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    PRIMARY KEY (playlist_id, track_id)
);
CREATE INDEX IF NOT EXISTS playlist_track_order_idx ON public.playlist_track (playlist_id, position, track_id);

CREATE TABLE IF NOT EXISTS public.change_log (
    id BIGSERIAL PRIMARY KEY,
    cursor_token UUID NOT NULL DEFAULT gen_random_uuid(),
    user_id BIGINT NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
    resource VARCHAR(8) NOT NULL CHECK (resource IN ('track', 'playlist')),
    resource_id BIGINT NOT NULL,
    action VARCHAR(6) NOT NULL CHECK (action IN ('upsert', 'delete')),
    created TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS change_log_user_id_idx ON public.change_log (user_id, id);

GRANT CONNECT ON DATABASE musico TO auth_api;
GRANT USAGE ON SCHEMA public TO auth_api;
GRANT SELECT, INSERT, DELETE ON TABLE public."user" TO auth_api;
GRANT USAGE, SELECT ON SEQUENCE public.user_id_seq TO auth_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.track, public.playlist, public.playlist_track TO auth_api;
GRANT SELECT, INSERT ON TABLE public.playlist_create_request TO auth_api;
GRANT SELECT, INSERT, DELETE ON TABLE public.track_upload_request TO auth_api;
GRANT SELECT, INSERT ON TABLE public.track_stat_request TO auth_api;
GRANT SELECT, INSERT ON TABLE public.change_log TO auth_api;
GRANT USAGE, SELECT ON SEQUENCE public.track_id_seq, public.playlist_id_seq, public.change_log_id_seq TO auth_api;
