-- Least-privilege grants for the runtime role on the notification tables (ADR-0003,
-- design "DB 設計"). The runtime may disable subscriptions via UPDATE but never
-- DELETE rows: sign-out / disable flows keep the history (design "DB 設計 > GRANT").
-- Schema USAGE must come first: table privileges alone cannot be reached otherwise.
GRANT USAGE ON SCHEMA "notification" TO app_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "notification"."push_subscriptions", "notification"."closed_push_sessions" TO app_runtime;
