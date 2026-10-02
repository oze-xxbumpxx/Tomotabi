-- Least-privilege grants for the runtime role on the finance tables (ADR-0003, design
-- "DB 設計 > GRANT"). History tables get SELECT and INSERT only; settlement.active_claims
-- also gets DELETE. infra.command_receipts (SELECT, INSERT) and
-- infra.trip_finance_guards (SELECT, INSERT) were granted in
-- drizzle/0004_planning_record_infra_grants.sql.
-- Schema USAGE must come first: table privileges alone cannot be reached otherwise.
GRANT USAGE ON SCHEMA "settlement" TO app_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT ON "record"."payments", "record"."payment_cancellations" TO app_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT ON "settlement"."previews", "settlement"."preview_items", "settlement"."settlements", "settlement"."items", "settlement"."cancellations" TO app_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "settlement"."active_claims" TO app_runtime;
--> statement-breakpoint
-- Column-level UPDATE: the settlement sequence is handed out here, and
-- SELECT ... FOR UPDATE on the guard row requires UPDATE privilege on some column.
GRANT UPDATE ("next_settlement_sequence") ON "infra"."trip_finance_guards" TO app_runtime;
