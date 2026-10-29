-- Clean up a RESTORED COPY of the database (design production-launch, docs/runbooks/backup-and-restore.md):
-- ends every login session and disables every push subscription, so the copy can neither act as
-- one of the two people nor send notifications.
-- NEVER run this on production: it would log both people out and stop their notifications.
-- To make that hard to do by accident, it refuses to run unless the session names the database it is
-- connected to as the restored copy (restored copies are created as tomotabi_restored; production is neondb):
--   PGOPTIONS='-c tomotabi.restored_copy=tomotabi_restored' psql "$RESTORED_URL" -v ON_ERROR_STOP=1 \
--     -f apps/api/db/admin/neutralize-restored.sql
-- Run as the owner of the restored objects (migrator). It does not touch the tables verify-restore.sql counts.
BEGIN;

DO $$
BEGIN
  RAISE NOTICE 'connected to database % on %', current_database(), coalesce(host(inet_server_addr()), 'local socket');
  IF coalesce(current_setting('tomotabi.restored_copy', true), '') <> current_database() THEN
    RAISE EXCEPTION 'neutralize-restored.sql runs only on a restored copy (set tomotabi.restored_copy to this database name, %)',
      current_database();
  END IF;
END
$$;

DELETE FROM identity.sessions;
DELETE FROM identity.verifications;
UPDATE notification.push_subscriptions
SET enabled = false, revision = revision + 1, updated_at = now()
WHERE enabled;

COMMIT;

SELECT (SELECT count(*) FROM identity.sessions) AS sessions,
       (SELECT count(*) FROM identity.verifications) AS verifications,
       (SELECT count(*) FROM notification.push_subscriptions WHERE enabled) AS enabled_push_subscriptions;
