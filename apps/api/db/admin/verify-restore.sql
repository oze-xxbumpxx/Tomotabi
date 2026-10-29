-- Numbers for checking a restored dump against production (design production-launch, OPS-13).
-- Read-only, so it also runs on production. Run it on production right before AND right after the dump;
-- if the two outputs match, nobody wrote in between and that output is the reference. Then run it on
-- the restored copy (after neutralize-restored.sql) and compare. Every row must match, and
-- active_claims.mismatch_with_history must be 0 on both sides.
--   psql "$URL" -v ON_ERROR_STOP=1 -At -F ' ' -f apps/api/db/admin/verify-restore.sql
-- Login sessions, auth verifications and push subscriptions are left out on purpose: they change
-- whenever someone opens the app, and neutralize-restored.sql clears them.
SELECT check_name, value
FROM (
  SELECT 'migrations.count' AS check_name, count(*)::text AS value FROM drizzle.__drizzle_migrations
  UNION ALL
  SELECT 'migrations.last_hash',
         coalesce((SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at DESC, id DESC LIMIT 1), '')
  UNION ALL
  SELECT 'identity.allowed_google_accounts',
         coalesce(string_agg(slot || ':' || user_id || ':' || enabled, ',' ORDER BY slot), '')
  FROM identity.allowed_google_accounts
  UNION ALL SELECT 'identity.users.count', count(*)::text FROM identity.users
  UNION ALL SELECT 'identity.accounts.count', count(*)::text FROM identity.accounts
  UNION ALL SELECT 'planning.trips.count', count(*)::text FROM planning.trips
  UNION ALL SELECT 'planning.trip_participants.count', count(*)::text FROM planning.trip_participants
  UNION ALL SELECT 'planning.plans.count', count(*)::text FROM planning.plans
  UNION ALL SELECT 'record.plan_events.count', count(*)::text FROM record.plan_events
  UNION ALL SELECT 'record.plan_event_cancellations.count', count(*)::text FROM record.plan_event_cancellations
  UNION ALL SELECT 'record.active_plan_events.count', count(*)::text FROM record.active_plan_events
  UNION ALL SELECT 'record.payments.count', count(*)::text FROM record.payments
  UNION ALL
  SELECT 'record.payments.sum_yen',
         coalesce(sum(amount_yen), 0) || '/' || coalesce(sum(slot0_burden_yen), 0) || '/'
           || coalesce(sum(slot1_burden_yen), 0) || '/' || coalesce(sum(contribution_yen), 0)
  FROM record.payments
  UNION ALL SELECT 'record.payment_cancellations.count', count(*)::text FROM record.payment_cancellations
  UNION ALL SELECT 'settlement.previews.count', count(*)::text FROM settlement.previews
  UNION ALL SELECT 'settlement.preview_items.count', count(*)::text FROM settlement.preview_items
  UNION ALL SELECT 'settlement.settlements.count', count(*)::text FROM settlement.settlements
  UNION ALL
  SELECT 'settlement.settlements.sum_signed_total_yen', coalesce(sum(signed_total_yen), 0)::text
  FROM settlement.settlements
  UNION ALL SELECT 'settlement.items.count', count(*)::text FROM settlement.items
  UNION ALL
  SELECT 'settlement.items.sum_contribution_yen', coalesce(sum(contribution_yen), 0)::text FROM settlement.items
  UNION ALL SELECT 'settlement.cancellations.count', count(*)::text FROM settlement.cancellations
  UNION ALL SELECT 'settlement.active_claims.count', count(*)::text FROM settlement.active_claims
  UNION ALL
  -- An item claims its payment while its settlement is not cancelled (the API inserts every item of a
  -- settlement into active_claims and deletes them all when the settlement is cancelled).
  SELECT 'settlement.active_claims.mismatch_with_history', count(*)::text
  FROM (
    (SELECT trip_id, payment_id, kind, settlement_id FROM settlement.active_claims
     EXCEPT
     SELECT i.trip_id, i.payment_id, i.kind, i.settlement_id FROM settlement.items i
     WHERE NOT EXISTS (SELECT 1 FROM settlement.cancellations c WHERE c.settlement_id = i.settlement_id))
    UNION ALL
    (SELECT i.trip_id, i.payment_id, i.kind, i.settlement_id FROM settlement.items i
     WHERE NOT EXISTS (SELECT 1 FROM settlement.cancellations c WHERE c.settlement_id = i.settlement_id)
     EXCEPT
     SELECT trip_id, payment_id, kind, settlement_id FROM settlement.active_claims)
  ) AS differences
  UNION ALL SELECT 'infra.trip_finance_guards.count', count(*)::text FROM infra.trip_finance_guards
  UNION ALL SELECT 'infra.command_receipts.count', count(*)::text FROM infra.command_receipts
) AS checks
ORDER BY check_name;
