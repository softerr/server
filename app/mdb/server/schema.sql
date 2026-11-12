CREATE TABLE IF NOT EXISTS public."user" (
    id BIGSERIAL PRIMARY KEY,
    auth_user_id BIGINT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS public.user_database (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL CHECK (length(trim(name)) > 0),
    created TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS user_database_user_name_idx
    ON public.user_database (user_id, lower(name));
CREATE INDEX IF NOT EXISTS user_database_user_id_idx
    ON public.user_database (user_id, id DESC);

CREATE TABLE IF NOT EXISTS public.database_share (
    database_id BIGINT NOT NULL REFERENCES public.user_database(id) ON DELETE CASCADE,
    auth_user_id BIGINT NOT NULL,
    can_edit BOOLEAN NOT NULL DEFAULT FALSE,
    created TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (database_id, auth_user_id)
);
CREATE INDEX IF NOT EXISTS database_share_user_idx
    ON public.database_share (auth_user_id, database_id);

CREATE TABLE IF NOT EXISTS public.database_column (
    id BIGSERIAL PRIMARY KEY,
    database_id BIGINT NOT NULL REFERENCES public.user_database(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL CHECK (length(trim(name)) > 0),
    position INTEGER NOT NULL CHECK (position > 0),
    width INTEGER CHECK (width BETWEEN 96 AND 1200),
    type VARCHAR(16) NOT NULL DEFAULT 'text',
    options JSONB NOT NULL DEFAULT '[]'::jsonb,
    relation_database_id BIGINT REFERENCES public.user_database(id) ON DELETE CASCADE,
    relation_display_column_id BIGINT REFERENCES public.database_column(id) ON DELETE SET NULL,
    UNIQUE (database_id, id),
    UNIQUE (database_id, position)
);
CREATE UNIQUE INDEX IF NOT EXISTS database_column_name_idx
    ON public.database_column (database_id, lower(name));
CREATE INDEX IF NOT EXISTS database_column_relation_database_id_idx
    ON public.database_column (relation_database_id, database_id, id)
    WHERE relation_database_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.database_row (
    id BIGSERIAL PRIMARY KEY,
    database_id BIGINT NOT NULL REFERENCES public.user_database(id) ON DELETE CASCADE,
    position BIGINT NOT NULL CHECK (position > 0),
    UNIQUE (database_id, id),
    UNIQUE (database_id, position)
);

CREATE TABLE IF NOT EXISTS public.database_cell (
    database_id BIGINT NOT NULL,
    row_id BIGINT NOT NULL,
    column_id BIGINT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (row_id, column_id),
    FOREIGN KEY (database_id, row_id)
        REFERENCES public.database_row (database_id, id) ON DELETE CASCADE,
    FOREIGN KEY (database_id, column_id)
        REFERENCES public.database_column (database_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS database_cell_column_idx
    ON public.database_cell (database_id, column_id);

CREATE OR REPLACE FUNCTION public.mdb_plain_cell_label(cell_type text, stored text)
RETURNS text LANGUAGE sql STABLE AS $$
    SELECT CASE
        WHEN cell_type = 'checkbox' THEN CASE WHEN stored = 'true' THEN 'Yes' ELSE 'No' END
        WHEN cell_type IN ('multi_select', 'multi_relation') AND stored IS NOT NULL THEN
            (SELECT string_agg(item.value, ', ' ORDER BY item.position)
             FROM jsonb_array_elements_text(stored::jsonb) WITH ORDINALITY AS item(value, position))
        ELSE stored
    END
$$;

CREATE OR REPLACE FUNCTION public.mdb_row_label(target_database BIGINT, target_row BIGINT, display_column BIGINT)
RETURNS text LANGUAGE sql STABLE AS $$
    SELECT CASE WHEN display_column IS NOT NULL THEN
        COALESCE((SELECT public.mdb_plain_cell_label(c.type, v.value)
                  FROM public.database_column c
                  LEFT JOIN public.database_cell v ON v.column_id = c.id AND v.row_id = r.id
                  WHERE c.database_id = r.database_id AND c.id = display_column), '—')
        ELSE 'Row ' || r.position || COALESCE((
            SELECT ': ' || public.mdb_plain_cell_label(c.type, v.value)
            FROM public.database_column c JOIN public.database_cell v
              ON v.column_id = c.id AND v.row_id = r.id
            WHERE c.database_id = r.database_id AND v.value <> ''
            ORDER BY (c.type = 'text') DESC, c.position LIMIT 1), '')
        END
    FROM public.database_row r WHERE r.database_id = target_database AND r.id = target_row
$$;

CREATE OR REPLACE FUNCTION public.mdb_visible_cell_label(
    cell_type text, stored text, related_database BIGINT, display_column BIGINT)
RETURNS text LANGUAGE sql STABLE AS $$
    SELECT CASE
        WHEN cell_type = 'relation' AND stored IS NOT NULL THEN
            COALESCE(public.mdb_row_label(related_database, stored::bigint, display_column), 'Missing row ' || stored)
        WHEN cell_type = 'multi_relation' AND stored IS NOT NULL THEN
            (SELECT string_agg(COALESCE(public.mdb_row_label(related_database, item.value::bigint,
                display_column), 'Missing row ' || item.value), ', ' ORDER BY item.position)
             FROM jsonb_array_elements_text(stored::jsonb) WITH ORDINALITY AS item(value, position))
        ELSE public.mdb_plain_cell_label(cell_type, stored)
    END
$$;

CREATE TABLE IF NOT EXISTS public.cell_suggestion (
    id BIGSERIAL PRIMARY KEY,
    database_id BIGINT NOT NULL REFERENCES public.user_database(id) ON DELETE CASCADE,
    token_id BIGINT NOT NULL,
    proposer_name VARCHAR(100) NOT NULL,
    title VARCHAR(100) NOT NULL,
    request_id UUID,
    request_sha256 CHAR(64),
    status VARCHAR(16) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'accepted', 'declined')),
    created TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reviewed_at TIMESTAMPTZ,
    UNIQUE (token_id, request_id)
);
CREATE INDEX IF NOT EXISTS cell_suggestion_database_idx
    ON public.cell_suggestion (database_id, id DESC);
CREATE TABLE IF NOT EXISTS public.cell_suggestion_change (
    suggestion_id BIGINT NOT NULL REFERENCES public.cell_suggestion(id) ON DELETE CASCADE,
    row_id BIGINT NOT NULL,
    column_id BIGINT NOT NULL,
    column_name VARCHAR(100) NOT NULL,
    column_type VARCHAR(16) NOT NULL,
    before_value TEXT,
    proposed_value JSONB NOT NULL,
    reason VARCHAR(500) NOT NULL,
    PRIMARY KEY (suggestion_id, row_id, column_id)
);
-- Keep the proposed row ID even if the owner deletes the row before reviewing it.
CREATE TABLE IF NOT EXISTS public.row_delete_suggestion (
    suggestion_id BIGINT NOT NULL REFERENCES public.cell_suggestion(id) ON DELETE CASCADE,
    row_id BIGINT NOT NULL,
    before_values JSONB NOT NULL,
    before_fields JSONB NOT NULL,
    row_label TEXT,
    reason VARCHAR(500) NOT NULL,
    PRIMARY KEY (suggestion_id, row_id)
);
CREATE TABLE IF NOT EXISTS public.row_create_suggestion (
    suggestion_id BIGINT NOT NULL REFERENCES public.cell_suggestion(id) ON DELETE CASCADE,
    item_index INTEGER NOT NULL CHECK (item_index > 0),
    proposed_values JSONB NOT NULL,
    proposed_fields JSONB NOT NULL,
    reason VARCHAR(500) NOT NULL,
    PRIMARY KEY (suggestion_id, item_index)
);

GRANT CONNECT ON DATABASE mdb TO auth_api;
GRANT USAGE ON SCHEMA public TO auth_api;
GRANT SELECT, INSERT, DELETE ON TABLE public."user" TO auth_api;
GRANT SELECT, INSERT ON TABLE public.user_database TO auth_api;
GRANT SELECT, INSERT, DELETE, UPDATE (can_edit) ON TABLE public.database_share TO auth_api;
GRANT SELECT, INSERT, DELETE ON TABLE public.database_column, public.database_row TO auth_api;
GRANT UPDATE (name, position, width, type, options, relation_database_id, relation_display_column_id) ON TABLE public.database_column TO auth_api;
GRANT UPDATE (position) ON TABLE public.database_row TO auth_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.database_cell TO auth_api;
GRANT EXECUTE ON FUNCTION public.mdb_plain_cell_label(text, text) TO auth_api;
GRANT EXECUTE ON FUNCTION public.mdb_row_label(bigint, bigint, bigint) TO auth_api;
GRANT EXECUTE ON FUNCTION public.mdb_visible_cell_label(text, text, bigint, bigint) TO auth_api;
GRANT SELECT, INSERT, UPDATE (status, reviewed_at) ON TABLE public.cell_suggestion TO auth_api;
GRANT SELECT, INSERT ON TABLE public.cell_suggestion_change TO auth_api;
GRANT SELECT, INSERT ON TABLE public.row_delete_suggestion TO auth_api;
GRANT SELECT, INSERT ON TABLE public.row_create_suggestion TO auth_api;
GRANT USAGE, SELECT ON SEQUENCE public.user_id_seq TO auth_api;
GRANT USAGE, SELECT ON SEQUENCE public.user_database_id_seq TO auth_api;
GRANT USAGE, SELECT ON SEQUENCE public.database_column_id_seq, public.database_row_id_seq TO auth_api;
GRANT USAGE, SELECT ON SEQUENCE public.cell_suggestion_id_seq TO auth_api;
