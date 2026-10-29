-- Full stop (design production-launch, OPS-15): stops every API deployment, old ones and direct
-- requests included, because all of them reach the database as app_runtime.
-- Run as a role that may alter app_runtime and signal its backends (on Neon, the project owner role):
--   psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -f apps/api/db/admin/stop-runtime.sql
-- Safe to run again. migrator and the owner role keep working, so recovery can proceed while stopped.
-- Undo with resume-runtime.sql.
SET lock_timeout = '5s';

-- Refuse new logins first, so connections cut below cannot come back.
ALTER ROLE app_runtime NOLOGIN;

-- Cut what is still connected (including the pooler's server connections). Open transactions roll back.
-- The second argument waits up to 5 s for each backend to exit.
SELECT count(*) FILTER (WHERE pg_terminate_backend(pid, 5000)) AS terminated_app_runtime_connections
FROM pg_stat_activity
WHERE usename = 'app_runtime' AND pid <> pg_backend_pid();

-- pg_stat_activity is read once per transaction; read it again so the count below is current
-- even when the whole file is sent as one request.
SELECT pg_stat_clear_snapshot();

SELECT rolcanlogin AS app_runtime_can_login,
       (SELECT count(*) FROM pg_stat_activity WHERE usename = 'app_runtime') AS remaining_app_runtime_connections
FROM pg_roles
WHERE rolname = 'app_runtime';
