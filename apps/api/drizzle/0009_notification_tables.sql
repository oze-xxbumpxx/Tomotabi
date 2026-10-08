CREATE SCHEMA "notification";
--> statement-breakpoint
CREATE TABLE "notification"."closed_push_sessions" (
	"session_id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "closed_push_sessions_session_id_check" CHECK (length("notification"."closed_push_sessions"."session_id") > 0)
);
--> statement-breakpoint
CREATE TABLE "notification"."push_subscriptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"endpoint_hash" "bytea" NOT NULL,
	"p256dh" "bytea" NOT NULL,
	"auth_secret" "bytea" NOT NULL,
	"expiration_time" timestamp with time zone,
	"registration_session_id" text NOT NULL,
	"device_label" text NOT NULL,
	"vapid_key_id" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"revision" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscriptions_endpoint_hash_unique" UNIQUE("endpoint_hash"),
	CONSTRAINT "push_subscriptions_endpoint_check" CHECK (length("notification"."push_subscriptions"."endpoint") BETWEEN 1 AND 4096),
	CONSTRAINT "push_subscriptions_endpoint_hash_check" CHECK (octet_length("notification"."push_subscriptions"."endpoint_hash") = 32),
	CONSTRAINT "push_subscriptions_p256dh_check" CHECK (octet_length("notification"."push_subscriptions"."p256dh") = 65 AND get_byte("notification"."push_subscriptions"."p256dh", 0) = 4),
	CONSTRAINT "push_subscriptions_auth_secret_check" CHECK (octet_length("notification"."push_subscriptions"."auth_secret") = 16),
	CONSTRAINT "push_subscriptions_registration_session_id_check" CHECK (length("notification"."push_subscriptions"."registration_session_id") > 0),
	CONSTRAINT "push_subscriptions_device_label_check" CHECK (length("notification"."push_subscriptions"."device_label") BETWEEN 1 AND 60),
	CONSTRAINT "push_subscriptions_vapid_key_id_check" CHECK (length("notification"."push_subscriptions"."vapid_key_id") BETWEEN 1 AND 64),
	CONSTRAINT "push_subscriptions_revision_check" CHECK ("notification"."push_subscriptions"."revision" > 0),
	CONSTRAINT "push_subscriptions_updated_at_check" CHECK ("notification"."push_subscriptions"."updated_at" >= "notification"."push_subscriptions"."created_at")
);
--> statement-breakpoint
ALTER TABLE "notification"."closed_push_sessions" ADD CONSTRAINT "closed_push_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification"."push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "push_subscriptions_user" ON "notification"."push_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "push_subscriptions_session" ON "notification"."push_subscriptions" USING btree ("user_id","registration_session_id") WHERE "notification"."push_subscriptions"."enabled";