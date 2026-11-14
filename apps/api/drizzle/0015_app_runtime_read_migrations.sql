-- Lets the API report the last applied migration so the deploy workflow can stop before
-- shipping a commit whose migrations are not applied yet (docs/designs/migration-deploy-check.md
-- "DB 設計"). Read only: the API returns max(created_at) and nothing else from this table.
GRANT USAGE ON SCHEMA "drizzle" TO app_runtime;
--> statement-breakpoint
GRANT SELECT ON "drizzle"."__drizzle_migrations" TO app_runtime;
