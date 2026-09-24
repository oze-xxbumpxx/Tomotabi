-- Administrator procedure (ADR-0003): run once per database as a superuser, before migrations.
-- Passwords are passed as psql variables and never stored in this file:
--   psql "$ADMIN_DATABASE_URL" -v migrator_password=... -v app_runtime_password=... -f create-roles.sql
-- Not a migration: role DDL needs superuser/CREATEROLE and dumps do not carry roles.

CREATE ROLE migrator LOGIN PASSWORD :'migrator_password';
CREATE ROLE app_runtime LOGIN PASSWORD :'app_runtime_password';

-- statement_timeout applies to queries outside explicit transactions too (e.g. session lookups).
ALTER ROLE app_runtime SET statement_timeout = '5s';

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT, CREATE ON DATABASE %I TO migrator', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO app_runtime', current_database());
END
$$;

-- Nothing may be created in public by the runtime role.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
