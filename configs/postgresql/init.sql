-- Create/update API DB role using password from psql variable auth_api_password.
SELECT format('CREATE ROLE auth_api LOGIN PASSWORD %L', :'auth_api_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'auth_api') \gexec

SELECT format('ALTER ROLE auth_api LOGIN PASSWORD %L', :'auth_api_password') \gexec

SELECT 'CREATE DATABASE auth'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'auth') \gexec

-- Add more databases here using the same pattern:
-- SELECT 'CREATE DATABASE app'
-- WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'app') \gexec

\connect auth

CREATE TABLE IF NOT EXISTS public."user" (
    id BIGSERIAL PRIMARY KEY,
    username VARCHAR(100) NOT NULL UNIQUE,
    password TEXT NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    activated BOOLEAN NOT NULL DEFAULT FALSE
);

GRANT CONNECT ON DATABASE auth TO auth_api;
GRANT USAGE ON SCHEMA public TO auth_api;
GRANT SELECT, INSERT, UPDATE ON TABLE public."user" TO auth_api;
GRANT USAGE, SELECT ON SEQUENCE public.user_id_seq TO auth_api;
