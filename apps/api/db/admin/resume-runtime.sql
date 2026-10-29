-- Resume after stop-runtime.sql (design production-launch, OPS-15).
--   psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -f apps/api/db/admin/resume-runtime.sql
-- Safe to run again.
SET lock_timeout = '5s';

ALTER ROLE app_runtime LOGIN;

SELECT rolcanlogin AS app_runtime_can_login
FROM pg_roles
WHERE rolname = 'app_runtime';
