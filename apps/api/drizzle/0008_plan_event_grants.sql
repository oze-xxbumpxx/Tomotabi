-- Least-privilege grants for the runtime role on the record tables (ADR-0003, design
-- "DB 設計 > GRANT"). The history tables get INSERT on top of the SELECT granted in
-- drizzle/0004_planning_record_infra_grants.sql; UPDATE and DELETE stay denied so the
-- append-only history cannot be rewritten (the history triggers keep rejecting them
-- even for roles that have the privilege). record.active_plan_events also gets
-- DELETE: a cancellation removes the occupancy row in the same transaction.
GRANT INSERT ON "record"."plan_events", "record"."plan_event_cancellations" TO app_runtime;
--> statement-breakpoint
GRANT INSERT, DELETE ON "record"."active_plan_events" TO app_runtime;
