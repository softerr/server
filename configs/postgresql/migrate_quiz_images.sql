-- Run as postgres after quiz.sql and media.sql. Existing question JSON keeps
-- legacy IDs. The old quiz table remains available if an API deploy rolls back.
CREATE EXTENSION IF NOT EXISTS dblink;

CREATE TABLE IF NOT EXISTS public.legacy_quiz_image_import (
    legacy_id BIGINT PRIMARY KEY,
    imported_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
    -- A fresh quiz database has no legacy image table.
    IF NOT (SELECT present FROM dblink('dbname=quiz',
        'SELECT to_regclass(''public.image'') IS NOT NULL') AS legacy(present BOOLEAN)) THEN
        PERFORM setval(pg_get_serial_sequence('public.image', 'id'),
            GREATEST((SELECT COALESCE(MAX(id), 0) FROM public.image), 1000000000000), TRUE);
        RETURN;
    END IF;

    CREATE TEMP TABLE legacy_image ON COMMIT DROP AS
    SELECT * FROM dblink('dbname=quiz',
        'SELECT i.id, u.auth_user_id, i.sha256, i.original_name,
                i.mime_type, i.width, i.height, i.content
         FROM public.image i JOIN public."user" u ON u.id = i.user_id')
    AS legacy(id BIGINT, auth_user_id BIGINT, sha256 CHAR(64),
              original_name VARCHAR(255), mime_type VARCHAR(16),
              width INTEGER, height INTEGER, content BYTEA);

    -- The legacy ID range remains available for writes by an old API after
    -- rollback. New media IDs start at one trillion, below JS's safe integer.
    IF EXISTS (SELECT 1 FROM legacy_image WHERE id >= 1000000000000) THEN
        RAISE EXCEPTION 'Legacy quiz image ID overlaps the media ID range';
    END IF;

    -- Existing IDs may have been migrated on an earlier setup. A tracked ID
    -- must never be resurrected if its media entry was later deleted.
    DELETE FROM legacy_image l USING public.legacy_quiz_image_import m
    WHERE m.legacy_id = l.id;

    INSERT INTO public.image_blob (sha256, mime_type, width, height, content)
    SELECT DISTINCT ON (sha256) sha256, mime_type, width, height, content
    FROM legacy_image ORDER BY sha256, id
    ON CONFLICT (sha256) DO NOTHING;

    INSERT INTO public.image (id, blob_id, owner_auth_user_id, uploaded_by_auth_user_id, shared, original_name)
    SELECT l.id, b.id, l.auth_user_id, l.auth_user_id, FALSE, l.original_name
    FROM legacy_image l JOIN public.image_blob b ON b.sha256 = l.sha256
    ON CONFLICT (id) DO NOTHING;

    IF EXISTS (
        SELECT 1 FROM legacy_image l
        LEFT JOIN public.image i ON i.id = l.id
        LEFT JOIN public.image_blob b ON b.id = i.blob_id
        WHERE i.id IS NULL OR i.owner_auth_user_id IS DISTINCT FROM l.auth_user_id
           OR i.shared = TRUE OR b.sha256 IS DISTINCT FROM l.sha256
    ) THEN
        RAISE EXCEPTION 'Legacy quiz image ID conflicts with an existing media image';
    END IF;

    INSERT INTO public.legacy_quiz_image_import (legacy_id)
    SELECT id FROM legacy_image ON CONFLICT DO NOTHING;

    PERFORM setval(pg_get_serial_sequence('public.image', 'id'),
        GREATEST((SELECT COALESCE(MAX(id), 0) FROM public.image), 1000000000000), TRUE);
END $$;
