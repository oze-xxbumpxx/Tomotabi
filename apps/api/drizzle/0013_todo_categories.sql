CREATE TABLE "planning"."todo_categories" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"name" varchar(30) NOT NULL,
	"position" integer NOT NULL,
	"created_by" uuid NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "todo_categories_trip_id_id_unique" UNIQUE("trip_id","id"),
	CONSTRAINT "todo_categories_version_check" CHECK ("planning"."todo_categories"."version" > 0),
	CONSTRAINT "todo_category_name_nonempty" CHECK (char_length(btrim("planning"."todo_categories"."name")) > 0),
	CONSTRAINT "todo_category_position_check" CHECK ("planning"."todo_categories"."position" >= 0)
);
--> statement-breakpoint
ALTER TABLE "infra"."command_receipts" DROP CONSTRAINT "command_receipts_resource_type_check";--> statement-breakpoint
ALTER TABLE "planning"."todos" DROP CONSTRAINT "todo_plan_requires_done";--> statement-breakpoint
ALTER TABLE "planning"."todos" ADD COLUMN "category_id" uuid;--> statement-breakpoint
ALTER TABLE "planning"."todos" ADD COLUMN "assignee_id" uuid;--> statement-breakpoint
ALTER TABLE "planning"."todos" ADD COLUMN "due_on" date;--> statement-breakpoint
ALTER TABLE "planning"."todo_categories" ADD CONSTRAINT "todo_categories_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "planning"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning"."todo_categories" ADD CONSTRAINT "todo_category_creator_member" FOREIGN KEY ("trip_id","created_by") REFERENCES "planning"."trip_participants"("trip_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "todo_categories_list_idx" ON "planning"."todo_categories" USING btree ("trip_id","position","created_at","id");--> statement-breakpoint
ALTER TABLE "planning"."todos" ADD CONSTRAINT "todo_category_same_trip" FOREIGN KEY ("trip_id","category_id") REFERENCES "planning"."todo_categories"("trip_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning"."todos" ADD CONSTRAINT "todo_assignee_member" FOREIGN KEY ("trip_id","assignee_id") REFERENCES "planning"."trip_participants"("trip_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "infra"."command_receipts" ADD CONSTRAINT "command_receipts_resource_type_check" CHECK ("infra"."command_receipts"."resource_type" IN ('payment', 'payment_cancellation', 'preview', 'settlement', 'settlement_cancellation', 'plan', 'trip', 'plan_event', 'plan_event_cancellation', 'todo', 'todo_deletion', 'todo_category', 'todo_category_order', 'todo_category_deletion'));