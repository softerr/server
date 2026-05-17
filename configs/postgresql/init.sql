-- Create/update API DB role using password from psql variable auth_api_password.
SELECT format('CREATE ROLE auth_api LOGIN PASSWORD %L', :'auth_api_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'auth_api') \gexec

SELECT format('ALTER ROLE auth_api LOGIN PASSWORD %L', :'auth_api_password') \gexec

SELECT 'CREATE DATABASE auth'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'auth') \gexec

\connect auth

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DROP TABLE IF EXISTS public."user";

CREATE TABLE IF NOT EXISTS public."user" (
    id BIGSERIAL PRIMARY KEY,
    username VARCHAR(100) NOT NULL UNIQUE,
    password TEXT NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    verified BOOLEAN NOT NULL DEFAULT FALSE,
    created TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.user_token (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
    type VARCHAR(64) NOT NULL,
    hash TEXT NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
    expires TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '1 hour')
);

GRANT CONNECT ON DATABASE auth TO auth_api;
GRANT USAGE ON SCHEMA public TO auth_api;
GRANT SELECT, INSERT, UPDATE ON TABLE public."user" TO auth_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_token TO auth_api;
GRANT USAGE, SELECT ON SEQUENCE public.user_id_seq TO auth_api;
GRANT USAGE, SELECT ON SEQUENCE public.user_token_id_seq TO auth_api;
