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

CREATE TABLE IF NOT EXISTS public.database_column (
    id BIGSERIAL PRIMARY KEY,
    database_id BIGINT NOT NULL REFERENCES public.user_database(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL CHECK (length(trim(name)) > 0),
    position INTEGER NOT NULL CHECK (position > 0),
    type VARCHAR(16) NOT NULL DEFAULT 'text',
    options JSONB NOT NULL DEFAULT '[]'::jsonb,
    relation_database_id BIGINT REFERENCES public.user_database(id) ON DELETE CASCADE,
    relation_display_column_id BIGINT REFERENCES public.database_column(id) ON DELETE SET NULL,
    UNIQUE (database_id, id),
    UNIQUE (database_id, position)
);
CREATE UNIQUE INDEX IF NOT EXISTS database_column_name_idx
    ON public.database_column (database_id, lower(name));

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

GRANT CONNECT ON DATABASE mdb TO auth_api;
GRANT USAGE ON SCHEMA public TO auth_api;
GRANT SELECT, INSERT, DELETE ON TABLE public."user" TO auth_api;
GRANT SELECT, INSERT ON TABLE public.user_database TO auth_api;
GRANT SELECT, INSERT, DELETE ON TABLE public.database_column, public.database_row TO auth_api;
GRANT UPDATE (name, position, type, options, relation_database_id, relation_display_column_id) ON TABLE public.database_column TO auth_api;
GRANT UPDATE (position) ON TABLE public.database_row TO auth_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.database_cell TO auth_api;
GRANT USAGE, SELECT ON SEQUENCE public.user_id_seq TO auth_api;
GRANT USAGE, SELECT ON SEQUENCE public.user_database_id_seq TO auth_api;
GRANT USAGE, SELECT ON SEQUENCE public.database_column_id_seq, public.database_row_id_seq TO auth_api;
