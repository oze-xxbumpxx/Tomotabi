-- Least-privilege grants for the runtime role (ADR-0003, design "DB 設計").
-- The roles themselves are created by db/admin/create-roles.sql, not by migrations.
-- Never GRANT ALL. Every table added later must add its own explicit grants here.
GRANT USAGE ON SCHEMA "identity" TO app_runtime;
--> statement-breakpoint
GRANT SELECT ON "identity"."users", "identity"."accounts", "identity"."sessions", "identity"."verifications", "identity"."allowed_google_accounts" TO app_runtime;
--> statement-breakpoint
-- Better Auth may flip email_verified to true on sign-in; no other user column is writable at runtime.
GRANT UPDATE ("email_verified", "updated_at") ON "identity"."users" TO app_runtime;
--> statement-breakpoint
GRANT INSERT, UPDATE, DELETE ON "identity"."sessions", "identity"."verifications" TO app_runtime;
