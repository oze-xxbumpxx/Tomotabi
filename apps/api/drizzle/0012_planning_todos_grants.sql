-- Grants for the ToDo list (design docs/designs/trip-todo.md "DB 設計"). Unlike the other
-- planning tables, DELETE is granted: a ToDo can be removed after confirmation and nothing
-- (settlement, history) depends on it. UPDATE is limited to the mutable columns.
GRANT SELECT, INSERT, DELETE ON "planning"."todos" TO app_runtime;
--> statement-breakpoint
GRANT UPDATE ("name", "memo", "done_at", "done_by", "plan_id", "version", "updated_at") ON "planning"."todos" TO app_runtime;
