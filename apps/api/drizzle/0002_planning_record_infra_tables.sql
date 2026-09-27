CREATE SCHEMA "infra";
--> statement-breakpoint
CREATE SCHEMA "planning";
--> statement-breakpoint
CREATE SCHEMA "record";
--> statement-breakpoint
CREATE TABLE "infra"."command_receipts" (
	"actor_id" uuid NOT NULL,
	"operation" varchar(100) NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"http_status" smallint NOT NULL,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "command_receipts_actor_id_operation_idempotency_key_pk" PRIMARY KEY("actor_id","operation","idempotency_key"),
	CONSTRAINT "command_receipts_request_hash_check" CHECK ("infra"."command_receipts"."request_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "command_receipts_resource_type_check" CHECK ("infra"."command_receipts"."resource_type" IN ('payment', 'payment_cancellation', 'preview', 'settlement', 'settlement_cancellation', 'plan', 'trip', 'plan_event', 'plan_event_cancellation')),
	CONSTRAINT "command_receipts_http_status_check" CHECK ("infra"."command_receipts"."http_status" IN (200, 201)),
	CONSTRAINT "mutable_resource_receipt_snapshot" CHECK ("infra"."command_receipts"."resource_type" NOT IN ('plan', 'trip') OR "infra"."command_receipts"."response_body" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "infra"."trip_finance_guards" (
	"trip_id" uuid PRIMARY KEY NOT NULL,
	"next_settlement_sequence" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "trip_finance_guards_next_settlement_sequence_check" CHECK ("infra"."trip_finance_guards"."next_settlement_sequence" > 0)
);
--> statement-breakpoint
CREATE TABLE "planning"."plans" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"kind" text NOT NULL,
	"planned_date" date NOT NULL,
	"planned_time" time(0),
	"memo" varchar(2000),
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid,
	"version" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_trip_id_id_unique" UNIQUE("trip_id","id"),
	CONSTRAINT "plans_kind_check" CHECK ("planning"."plans"."kind" IN ('place', 'food', 'shopping', 'lodging', 'transport')),
	CONSTRAINT "plans_version_check" CHECK ("planning"."plans"."version" > 0),
	CONSTRAINT "plan_name_nonempty" CHECK (char_length(btrim("planning"."plans"."name")) > 0),
	CONSTRAINT "plan_time_minute" CHECK ("planning"."plans"."planned_time" IS NULL OR ("planning"."plans"."planned_time" < TIME '24:00' AND EXTRACT(SECOND FROM "planning"."plans"."planned_time") = 0)),
	CONSTRAINT "plan_cancellation_pair" CHECK (("planning"."plans"."cancelled_at" IS NULL) = ("planning"."plans"."cancelled_by" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "planning"."trip_participants" (
	"trip_id" uuid NOT NULL,
	"slot" smallint NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "trip_participants_trip_id_slot_pk" PRIMARY KEY("trip_id","slot"),
	CONSTRAINT "trip_participants_trip_id_user_id_unique" UNIQUE("trip_id","user_id"),
	CONSTRAINT "trip_participants_slot_check" CHECK ("planning"."trip_participants"."slot" IN (0, 1))
);
--> statement-breakpoint
CREATE TABLE "planning"."trips" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"status" text DEFAULT 'planning' NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"started_by" uuid,
	"finished_at" timestamp with time zone,
	"finished_by" uuid,
	CONSTRAINT "trips_status_check" CHECK ("planning"."trips"."status" IN ('planning', 'traveling', 'finished')),
	CONSTRAINT "trips_version_check" CHECK ("planning"."trips"."version" > 0),
	CONSTRAINT "trip_name_nonempty" CHECK (char_length(btrim("planning"."trips"."name")) > 0),
	CONSTRAINT "trip_period_valid" CHECK ("planning"."trips"."starts_on" <= "planning"."trips"."ends_on"),
	CONSTRAINT "trip_lifecycle_fields" CHECK (("planning"."trips"."status" = 'planning' AND "planning"."trips"."started_at" IS NULL AND "planning"."trips"."started_by" IS NULL AND "planning"."trips"."finished_at" IS NULL AND "planning"."trips"."finished_by" IS NULL)
          OR ("planning"."trips"."status" = 'traveling' AND "planning"."trips"."started_at" IS NOT NULL AND "planning"."trips"."started_by" IS NOT NULL AND "planning"."trips"."finished_at" IS NULL AND "planning"."trips"."finished_by" IS NULL)
          OR ("planning"."trips"."status" = 'finished' AND "planning"."trips"."started_at" IS NOT NULL AND "planning"."trips"."started_by" IS NOT NULL AND "planning"."trips"."finished_at" IS NOT NULL AND "planning"."trips"."finished_by" IS NOT NULL AND "planning"."trips"."finished_at" >= "planning"."trips"."started_at"))
);
--> statement-breakpoint
CREATE TABLE "record"."active_plan_events" (
	"trip_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"event_kind" text NOT NULL,
	"event_id" uuid NOT NULL,
	CONSTRAINT "active_plan_events_plan_id_event_kind_pk" PRIMARY KEY("plan_id","event_kind"),
	CONSTRAINT "active_plan_events_event_id_unique" UNIQUE("event_id"),
	CONSTRAINT "active_plan_events_event_kind_check" CHECK ("record"."active_plan_events"."event_kind" IN ('achievement', 'booking'))
);
--> statement-breakpoint
CREATE TABLE "record"."plan_event_cancellations" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"trip_id" uuid NOT NULL,
	"cancelled_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "record"."plan_events" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"event_kind" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_events_trip_id_plan_id_event_kind_id_unique" UNIQUE("trip_id","plan_id","event_kind","id"),
	CONSTRAINT "plan_events_trip_id_id_unique" UNIQUE("trip_id","id"),
	CONSTRAINT "plan_events_event_kind_check" CHECK ("record"."plan_events"."event_kind" IN ('achievement', 'booking'))
);
--> statement-breakpoint
ALTER TABLE "infra"."command_receipts" ADD CONSTRAINT "command_receipts_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "identity"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "infra"."command_receipts" ADD CONSTRAINT "command_receipts_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "planning"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "infra"."command_receipts" ADD CONSTRAINT "command_receipts_trip_id_actor_id_trip_participants_trip_id_user_id_fk" FOREIGN KEY ("trip_id","actor_id") REFERENCES "planning"."trip_participants"("trip_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "infra"."trip_finance_guards" ADD CONSTRAINT "trip_finance_guards_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "planning"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning"."plans" ADD CONSTRAINT "plans_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "planning"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning"."plans" ADD CONSTRAINT "plan_canceller_member" FOREIGN KEY ("trip_id","cancelled_by") REFERENCES "planning"."trip_participants"("trip_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning"."trip_participants" ADD CONSTRAINT "trip_participants_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "planning"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning"."trip_participants" ADD CONSTRAINT "trip_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning"."trips" ADD CONSTRAINT "trips_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "identity"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning"."trips" ADD CONSTRAINT "trip_starter_member" FOREIGN KEY ("id","started_by") REFERENCES "planning"."trip_participants"("trip_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning"."trips" ADD CONSTRAINT "trip_finisher_member" FOREIGN KEY ("id","finished_by") REFERENCES "planning"."trip_participants"("trip_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record"."active_plan_events" ADD CONSTRAINT "active_plan_events_trip_id_plan_id_event_kind_event_id_plan_events_trip_id_plan_id_event_kind_id_fk" FOREIGN KEY ("trip_id","plan_id","event_kind","event_id") REFERENCES "record"."plan_events"("trip_id","plan_id","event_kind","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record"."plan_event_cancellations" ADD CONSTRAINT "plan_event_cancellations_trip_id_event_id_plan_events_trip_id_id_fk" FOREIGN KEY ("trip_id","event_id") REFERENCES "record"."plan_events"("trip_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record"."plan_event_cancellations" ADD CONSTRAINT "plan_event_cancellations_trip_id_cancelled_by_trip_participants_trip_id_user_id_fk" FOREIGN KEY ("trip_id","cancelled_by") REFERENCES "planning"."trip_participants"("trip_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record"."plan_events" ADD CONSTRAINT "plan_events_trip_id_plan_id_plans_trip_id_id_fk" FOREIGN KEY ("trip_id","plan_id") REFERENCES "planning"."plans"("trip_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record"."plan_events" ADD CONSTRAINT "plan_events_trip_id_created_by_trip_participants_trip_id_user_id_fk" FOREIGN KEY ("trip_id","created_by") REFERENCES "planning"."trip_participants"("trip_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plans_day_idx" ON "planning"."plans" USING btree ("trip_id","planned_date","planned_time","created_at","id");--> statement-breakpoint
CREATE INDEX "trip_participants_user_idx" ON "planning"."trip_participants" USING btree ("user_id","trip_id");--> statement-breakpoint
CREATE INDEX "trips_list_idx" ON "planning"."trips" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "plan_event_cancellations_timeline_idx" ON "record"."plan_event_cancellations" USING btree ("trip_id","created_at" DESC NULLS LAST,"event_id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "plan_events_history_idx" ON "record"."plan_events" USING btree ("trip_id","plan_id");--> statement-breakpoint
CREATE INDEX "plan_events_timeline_idx" ON "record"."plan_events" USING btree ("trip_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);