-- Create databases idempotently from a single init file.
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
