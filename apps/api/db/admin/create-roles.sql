-- Administrator procedure, step 1 of 2 (ADR-0003): run ONCE PER CLUSTER as a superuser.
-- Roles belong to the whole PostgreSQL cluster, not to one database, so this is not repeated per database.
-- Passwords are passed as psql variables and never stored in this file:
--   psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -v migrator_password=... -v app_runtime_password=... -f create-roles.sql
-- Running it again fails on CREATE ROLE on purpose: changing a password is a separate, explicit ALTER ROLE.
-- Then run grant-database.sql for every database that uses these roles.

CREATE ROLE migrator LOGIN PASSWORD :'migrator_password';
CREATE ROLE app_runtime LOGIN PASSWORD :'app_runtime_password';

-- statement_timeout applies to queries outside explicit transactions too (e.g. session lookups).
ALTER ROLE app_runtime SET statement_timeout = '5s';
