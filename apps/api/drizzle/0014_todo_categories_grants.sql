-- Grants for the ToDo categories (design docs/designs/todo-organize.md "DB 設計").
-- Like todos, DELETE is granted: a category is removed after confirmation together with
-- the ToDo inside it, and nothing depends on it. UPDATE is limited to the mutable columns.
GRANT SELECT, INSERT, DELETE ON "planning"."todo_categories" TO app_runtime;
--> statement-breakpoint
GRANT UPDATE ("name", "position", "version", "updated_at") ON "planning"."todo_categories" TO app_runtime;
--> statement-breakpoint
GRANT UPDATE ("category_id", "assignee_id", "due_on") ON "planning"."todos" TO app_runtime;
