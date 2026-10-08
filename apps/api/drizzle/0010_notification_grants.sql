-- Least-privilege grants for the runtime role on the notification tables (ADR-0003,
-- design "DB 設計"). Subscriptions are disabled with UPDATE, never deleted, so
-- app_runtime gets SELECT, INSERT and UPDATE but no DELETE. identity privileges
-- stay as granted in drizzle/0001_app_runtime_grants.sql.
-- Schema USAGE must come first: table privileges alone cannot be reached otherwise.
GRANT USAGE ON SCHEMA "notification" TO app_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "notification"."push_subscriptions", "notification"."closed_push_sessions" TO app_runtime;
