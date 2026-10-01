CREATE SCHEMA "settlement";
--> statement-breakpoint
CREATE TABLE "record"."payment_cancellations" (
	"payment_id" uuid PRIMARY KEY NOT NULL,
	"trip_id" uuid NOT NULL,
	"cancelled_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "record"."payments" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"plan_id" uuid,
	"amount_yen" bigint NOT NULL,
	"payer_slot" smallint NOT NULL,
	"slot0_percent" smallint NOT NULL,
	"slot0_burden_yen" bigint NOT NULL,
	"slot1_burden_yen" bigint NOT NULL,
	"contribution_yen" bigint NOT NULL,
	"label" varchar(100),
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_trip_id_id_unique" UNIQUE("trip_id","id"),
	CONSTRAINT "payments_amount_yen_check" CHECK ("record"."payments"."amount_yen" BETWEEN 1 AND 9999999),
	CONSTRAINT "payments_payer_slot_check" CHECK ("record"."payments"."payer_slot" IN (0, 1)),
	CONSTRAINT "payments_slot0_percent_check" CHECK ("record"."payments"."slot0_percent" BETWEEN 0 AND 100),
	CONSTRAINT "payments_slot0_burden_yen_check" CHECK ("record"."payments"."slot0_burden_yen" >= 0),
	CONSTRAINT "payments_slot1_burden_yen_check" CHECK ("record"."payments"."slot1_burden_yen" >= 0),
	CONSTRAINT "payments_label_check" CHECK ("record"."payments"."label" IS NULL OR char_length(btrim("record"."payments"."label")) BETWEEN 1 AND 100),
	CONSTRAINT "payments_burden_sum" CHECK ("record"."payments"."slot0_burden_yen" + "record"."payments"."slot1_burden_yen" = "record"."payments"."amount_yen"),
	CONSTRAINT "payments_contribution" CHECK (("record"."payments"."payer_slot" = 0 AND "record"."payments"."slot1_burden_yen" = "record"."payments"."amount_yen" * (100 - "record"."payments"."slot0_percent") / 100 AND "record"."payments"."contribution_yen" = "record"."payments"."slot1_burden_yen")
          OR ("record"."payments"."payer_slot" = 1 AND "record"."payments"."slot0_burden_yen" = "record"."payments"."amount_yen" * "record"."payments"."slot0_percent" / 100 AND "record"."payments"."contribution_yen" = -"record"."payments"."slot0_burden_yen"))
);
--> statement-breakpoint
CREATE TABLE "settlement"."active_claims" (
	"trip_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"settlement_id" uuid NOT NULL,
	CONSTRAINT "active_claims_payment_id_kind_pk" PRIMARY KEY("payment_id","kind"),
	CONSTRAINT "active_claims_kind_check" CHECK ("settlement"."active_claims"."kind" IN ('BASE', 'REVERSAL'))
);
--> statement-breakpoint
CREATE TABLE "settlement"."preview_items" (
	"preview_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"contribution_yen" bigint NOT NULL,
	"base_settlement_id" uuid,
	"base_kind" text DEFAULT 'BASE' NOT NULL,
	"expected_claim_fingerprint" varchar(64) NOT NULL,
	"expected_cancelled" boolean NOT NULL,
	CONSTRAINT "preview_items_preview_id_payment_id_kind_pk" PRIMARY KEY("preview_id","payment_id","kind"),
	CONSTRAINT "preview_items_trip_id_preview_id_payment_id_kind_unique" UNIQUE("trip_id","preview_id","payment_id","kind"),
	CONSTRAINT "preview_items_preview_id_payment_id_unique" UNIQUE("preview_id","payment_id"),
	CONSTRAINT "preview_items_kind_check" CHECK ("settlement"."preview_items"."kind" IN ('BASE', 'REVERSAL')),
	CONSTRAINT "preview_items_base_kind_check" CHECK ("settlement"."preview_items"."base_kind" = 'BASE'),
	CONSTRAINT "preview_items_expected_claim_fingerprint_check" CHECK ("settlement"."preview_items"."expected_claim_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "preview_items_reversal_shape" CHECK (("settlement"."preview_items"."kind" = 'BASE' AND "settlement"."preview_items"."base_settlement_id" IS NULL AND NOT "settlement"."preview_items"."expected_cancelled")
          OR ("settlement"."preview_items"."kind" = 'REVERSAL' AND "settlement"."preview_items"."base_settlement_id" IS NOT NULL AND "settlement"."preview_items"."expected_cancelled"))
);
--> statement-breakpoint
CREATE TABLE "settlement"."previews" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"signed_total_yen" bigint NOT NULL,
	CONSTRAINT "previews_trip_id_id_unique" UNIQUE("trip_id","id")
);
--> statement-breakpoint
CREATE TABLE "settlement"."cancellations" (
	"settlement_id" uuid PRIMARY KEY NOT NULL,
	"trip_id" uuid NOT NULL,
	"cancelled_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlement"."items" (
	"settlement_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"preview_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"contribution_yen" bigint NOT NULL,
	"base_settlement_id" uuid,
	"base_kind" text DEFAULT 'BASE' NOT NULL,
	CONSTRAINT "items_settlement_id_payment_id_kind_pk" PRIMARY KEY("settlement_id","payment_id","kind"),
	CONSTRAINT "items_trip_id_settlement_id_payment_id_kind_unique" UNIQUE("trip_id","settlement_id","payment_id","kind"),
	CONSTRAINT "items_settlement_id_payment_id_unique" UNIQUE("settlement_id","payment_id"),
	CONSTRAINT "items_kind_check" CHECK ("settlement"."items"."kind" IN ('BASE', 'REVERSAL')),
	CONSTRAINT "items_base_kind_check" CHECK ("settlement"."items"."base_kind" = 'BASE'),
	CONSTRAINT "items_reversal_shape" CHECK (("settlement"."items"."kind" = 'BASE' AND "settlement"."items"."base_settlement_id" IS NULL)
          OR ("settlement"."items"."kind" = 'REVERSAL' AND "settlement"."items"."base_settlement_id" IS NOT NULL)),
	CONSTRAINT "items_no_self_base" CHECK ("settlement"."items"."base_settlement_id" IS NULL OR "settlement"."items"."base_settlement_id" <> "settlement"."items"."settlement_id")
);
--> statement-breakpoint
CREATE TABLE "settlement"."settlements" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"preview_id" uuid NOT NULL,
	"sequence" bigint NOT NULL,
	"signed_total_yen" bigint NOT NULL,
	"completion_kind" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settlements_preview_id_unique" UNIQUE("preview_id"),
	CONSTRAINT "settlements_trip_id_id_unique" UNIQUE("trip_id","id"),
	CONSTRAINT "settlements_trip_id_sequence_unique" UNIQUE("trip_id","sequence"),
	CONSTRAINT "settlements_trip_id_id_preview_id_unique" UNIQUE("trip_id","id","preview_id"),
	CONSTRAINT "settlements_sequence_check" CHECK ("settlement"."settlements"."sequence" > 0),
	CONSTRAINT "settlements_completion_kind_check" CHECK ("settlement"."settlements"."completion_kind" IN ('transfer_completed', 'no_transfer_required')),
	CONSTRAINT "settlements_completion_total" CHECK (("settlement"."settlements"."signed_total_yen" = 0 AND "settlement"."settlements"."completion_kind" = 'no_transfer_required')
          OR ("settlement"."settlements"."signed_total_yen" <> 0 AND "settlement"."settlements"."completion_kind" = 'transfer_completed'))
);
--> statement-breakpoint
ALTER TABLE "record"."payment_cancellations" ADD CONSTRAINT "payment_cancellations_trip_id_payment_id_payments_trip_id_id_fk" FOREIGN KEY ("trip_id","payment_id") REFERENCES "record"."payments"("trip_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record"."payment_cancellations" ADD CONSTRAINT "payment_cancellations_trip_id_cancelled_by_trip_participants_trip_id_user_id_fk" FOREIGN KEY ("trip_id","cancelled_by") REFERENCES "planning"."trip_participants"("trip_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record"."payments" ADD CONSTRAINT "payments_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "planning"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record"."payments" ADD CONSTRAINT "payments_trip_id_plan_id_plans_trip_id_id_fk" FOREIGN KEY ("trip_id","plan_id") REFERENCES "planning"."plans"("trip_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record"."payments" ADD CONSTRAINT "payments_trip_id_payer_slot_trip_participants_trip_id_slot_fk" FOREIGN KEY ("trip_id","payer_slot") REFERENCES "planning"."trip_participants"("trip_id","slot") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record"."payments" ADD CONSTRAINT "payments_trip_id_created_by_trip_participants_trip_id_user_id_fk" FOREIGN KEY ("trip_id","created_by") REFERENCES "planning"."trip_participants"("trip_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement"."active_claims" ADD CONSTRAINT "active_claims_trip_id_settlement_id_payment_id_kind_items_trip_id_settlement_id_payment_id_kind_fk" FOREIGN KEY ("trip_id","settlement_id","payment_id","kind") REFERENCES "settlement"."items"("trip_id","settlement_id","payment_id","kind") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement"."preview_items" ADD CONSTRAINT "preview_items_trip_id_preview_id_previews_trip_id_id_fk" FOREIGN KEY ("trip_id","preview_id") REFERENCES "settlement"."previews"("trip_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement"."preview_items" ADD CONSTRAINT "preview_items_trip_id_payment_id_payments_trip_id_id_fk" FOREIGN KEY ("trip_id","payment_id") REFERENCES "record"."payments"("trip_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement"."preview_items" ADD CONSTRAINT "preview_reversal_base_fk" FOREIGN KEY ("trip_id","base_settlement_id","payment_id","base_kind") REFERENCES "settlement"."items"("trip_id","settlement_id","payment_id","kind") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement"."previews" ADD CONSTRAINT "previews_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "planning"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement"."previews" ADD CONSTRAINT "previews_trip_id_created_by_trip_participants_trip_id_user_id_fk" FOREIGN KEY ("trip_id","created_by") REFERENCES "planning"."trip_participants"("trip_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement"."cancellations" ADD CONSTRAINT "cancellations_trip_id_settlement_id_settlements_trip_id_id_fk" FOREIGN KEY ("trip_id","settlement_id") REFERENCES "settlement"."settlements"("trip_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement"."cancellations" ADD CONSTRAINT "cancellations_trip_id_cancelled_by_trip_participants_trip_id_user_id_fk" FOREIGN KEY ("trip_id","cancelled_by") REFERENCES "planning"."trip_participants"("trip_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement"."items" ADD CONSTRAINT "items_trip_id_settlement_id_preview_id_settlements_trip_id_id_preview_id_fk" FOREIGN KEY ("trip_id","settlement_id","preview_id") REFERENCES "settlement"."settlements"("trip_id","id","preview_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement"."items" ADD CONSTRAINT "items_trip_id_preview_id_payment_id_kind_preview_items_trip_id_preview_id_payment_id_kind_fk" FOREIGN KEY ("trip_id","preview_id","payment_id","kind") REFERENCES "settlement"."preview_items"("trip_id","preview_id","payment_id","kind") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement"."items" ADD CONSTRAINT "items_trip_id_payment_id_payments_trip_id_id_fk" FOREIGN KEY ("trip_id","payment_id") REFERENCES "record"."payments"("trip_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement"."items" ADD CONSTRAINT "items_reversal_base_fk" FOREIGN KEY ("trip_id","base_settlement_id","payment_id","base_kind") REFERENCES "settlement"."items"("trip_id","settlement_id","payment_id","kind") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement"."settlements" ADD CONSTRAINT "settlements_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "planning"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement"."settlements" ADD CONSTRAINT "settlements_trip_id_preview_id_previews_trip_id_id_fk" FOREIGN KEY ("trip_id","preview_id") REFERENCES "settlement"."previews"("trip_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement"."settlements" ADD CONSTRAINT "settlements_trip_id_created_by_trip_participants_trip_id_user_id_fk" FOREIGN KEY ("trip_id","created_by") REFERENCES "planning"."trip_participants"("trip_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_cancellations_trip_idx" ON "record"."payment_cancellations" USING btree ("trip_id");--> statement-breakpoint
CREATE INDEX "payments_trip_created_idx" ON "record"."payments" USING btree ("trip_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "payments_plan_idx" ON "record"."payments" USING btree ("trip_id","plan_id") WHERE "record"."payments"."plan_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "active_claims_settlement_idx" ON "settlement"."active_claims" USING btree ("trip_id","settlement_id");--> statement-breakpoint
CREATE INDEX "previews_owner_idx" ON "settlement"."previews" USING btree ("trip_id","created_by","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "settlement_cancellations_trip_idx" ON "settlement"."cancellations" USING btree ("trip_id");--> statement-breakpoint
CREATE INDEX "settlement_items_payment_idx" ON "settlement"."items" USING btree ("trip_id","payment_id","settlement_id");--> statement-breakpoint
CREATE INDEX "settlements_latest_idx" ON "settlement"."settlements" USING btree ("trip_id","sequence" DESC NULLS LAST);