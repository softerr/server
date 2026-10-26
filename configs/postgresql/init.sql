SELECT format('CREATE ROLE auth_api LOGIN PASSWORD %L', :'auth_api_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'auth_api') \gexec

SELECT format('ALTER ROLE auth_api LOGIN PASSWORD %L', :'auth_api_password') \gexec

SELECT 'CREATE DATABASE auth'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'auth') \gexec

SELECT 'CREATE DATABASE quiz'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'quiz') \gexec
