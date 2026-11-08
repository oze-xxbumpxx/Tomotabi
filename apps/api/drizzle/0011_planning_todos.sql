CREATE TABLE "planning"."todos" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"memo" varchar(2000),
	"created_by" uuid NOT NULL,
	"done_at" timestamp with time zone,
	"done_by" uuid,
	"plan_id" uuid,
	"version" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "todos_trip_id_id_unique" UNIQUE("trip_id","id"),
	CONSTRAINT "todos_version_check" CHECK ("planning"."todos"."version" > 0),
	CONSTRAINT "todo_name_nonempty" CHECK (char_length(btrim("planning"."todos"."name")) > 0),
	CONSTRAINT "todo_done_pair" CHECK (("planning"."todos"."done_at" IS NULL) = ("planning"."todos"."done_by" IS NULL)),
	CONSTRAINT "todo_plan_requires_done" CHECK ("planning"."todos"."plan_id" IS NULL OR "planning"."todos"."done_at" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "infra"."command_receipts" DROP CONSTRAINT "command_receipts_resource_type_check";--> statement-breakpoint
ALTER TABLE "planning"."todos" ADD CONSTRAINT "todos_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "planning"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning"."todos" ADD CONSTRAINT "todo_creator_member" FOREIGN KEY ("trip_id","created_by") REFERENCES "planning"."trip_participants"("trip_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning"."todos" ADD CONSTRAINT "todo_completer_member" FOREIGN KEY ("trip_id","done_by") REFERENCES "planning"."trip_participants"("trip_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning"."todos" ADD CONSTRAINT "todo_plan_same_trip" FOREIGN KEY ("trip_id","plan_id") REFERENCES "planning"."plans"("trip_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "todos_list_idx" ON "planning"."todos" USING btree ("trip_id","created_at","id");--> statement-breakpoint
ALTER TABLE "infra"."command_receipts" ADD CONSTRAINT "command_receipts_resource_type_check" CHECK ("infra"."command_receipts"."resource_type" IN ('payment', 'payment_cancellation', 'preview', 'settlement', 'settlement_cancellation', 'plan', 'trip', 'plan_event', 'plan_event_cancellation', 'todo', 'todo_deletion'));