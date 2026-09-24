-- Administrator procedure, step 2 of 2 (ADR-0003): run as a superuser against EACH database,
-- after create-roles.sql and before migrations. Safe to run again: GRANT and REVOKE are idempotent.
--   psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f grant-database.sql

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT, CREATE ON DATABASE %I TO migrator', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO app_runtime', current_database());
END
$$;

-- The public schema is per database. Nothing may be created in it by the runtime role.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
