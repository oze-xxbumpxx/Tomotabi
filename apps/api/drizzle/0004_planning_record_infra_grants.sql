-- Least-privilege grants for the runtime role (ADR-0003, design "DB 設計 > GRANT").
-- DELETE is never granted. UPDATE is granted per column on trips / plans.
-- Schema USAGE must come first: table privileges alone cannot be reached otherwise.
GRANT USAGE ON SCHEMA "planning", "record", "infra" TO app_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT ON "planning"."trips" TO app_runtime;
--> statement-breakpoint
GRANT UPDATE ("name", "starts_on", "ends_on", "status", "version", "updated_at", "started_at", "started_by", "finished_at", "finished_by") ON "planning"."trips" TO app_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT ON "planning"."trip_participants" TO app_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT ON "planning"."plans" TO app_runtime;
--> statement-breakpoint
GRANT UPDATE ("name", "kind", "planned_date", "planned_time", "memo", "cancelled_at", "cancelled_by", "version", "updated_at") ON "planning"."plans" TO app_runtime;
--> statement-breakpoint
-- record tables are read-only for now; INSERT (and DELETE on active rows) is granted in M4.
GRANT SELECT ON "record"."plan_events", "record"."plan_event_cancellations", "record"."active_plan_events" TO app_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT ON "infra"."trip_finance_guards", "infra"."command_receipts" TO app_runtime;
