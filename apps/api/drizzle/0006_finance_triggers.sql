-- Append-only history guarantee for the finance tables (design "DB 設計 > GRANT"/trigger
-- section, reference SQL 01_finance.sql). Reuses infra.reject_history_mutation from
-- drizzle/0003_history_triggers.sql. settlement.active_claims stays mutable (it is
-- occupancy state, not history), so it gets no trigger.
CREATE TRIGGER reject_mutation BEFORE UPDATE OR DELETE ON "record"."payments"
 FOR EACH ROW EXECUTE FUNCTION "infra"."reject_history_mutation"();
--> statement-breakpoint
CREATE TRIGGER reject_mutation BEFORE UPDATE OR DELETE ON "record"."payment_cancellations"
 FOR EACH ROW EXECUTE FUNCTION "infra"."reject_history_mutation"();
--> statement-breakpoint
CREATE TRIGGER reject_mutation BEFORE UPDATE OR DELETE ON "settlement"."previews"
 FOR EACH ROW EXECUTE FUNCTION "infra"."reject_history_mutation"();
--> statement-breakpoint
CREATE TRIGGER reject_mutation BEFORE UPDATE OR DELETE ON "settlement"."preview_items"
 FOR EACH ROW EXECUTE FUNCTION "infra"."reject_history_mutation"();
--> statement-breakpoint
CREATE TRIGGER reject_mutation BEFORE UPDATE OR DELETE ON "settlement"."settlements"
 FOR EACH ROW EXECUTE FUNCTION "infra"."reject_history_mutation"();
--> statement-breakpoint
CREATE TRIGGER reject_mutation BEFORE UPDATE OR DELETE ON "settlement"."items"
 FOR EACH ROW EXECUTE FUNCTION "infra"."reject_history_mutation"();
--> statement-breakpoint
CREATE TRIGGER reject_mutation BEFORE UPDATE OR DELETE ON "settlement"."cancellations"
 FOR EACH ROW EXECUTE FUNCTION "infra"."reject_history_mutation"();
--> statement-breakpoint
-- TRUNCATE は行トリガーを通らないので、文トリガーで別途止める（表の所有者でも空にできない）。
CREATE TRIGGER reject_mutation_truncate BEFORE TRUNCATE ON "record"."payments"
 FOR EACH STATEMENT EXECUTE FUNCTION "infra"."reject_history_mutation"();
--> statement-breakpoint
CREATE TRIGGER reject_mutation_truncate BEFORE TRUNCATE ON "record"."payment_cancellations"
 FOR EACH STATEMENT EXECUTE FUNCTION "infra"."reject_history_mutation"();
--> statement-breakpoint
CREATE TRIGGER reject_mutation_truncate BEFORE TRUNCATE ON "settlement"."previews"
 FOR EACH STATEMENT EXECUTE FUNCTION "infra"."reject_history_mutation"();
--> statement-breakpoint
CREATE TRIGGER reject_mutation_truncate BEFORE TRUNCATE ON "settlement"."preview_items"
 FOR EACH STATEMENT EXECUTE FUNCTION "infra"."reject_history_mutation"();
--> statement-breakpoint
CREATE TRIGGER reject_mutation_truncate BEFORE TRUNCATE ON "settlement"."settlements"
 FOR EACH STATEMENT EXECUTE FUNCTION "infra"."reject_history_mutation"();
--> statement-breakpoint
CREATE TRIGGER reject_mutation_truncate BEFORE TRUNCATE ON "settlement"."items"
 FOR EACH STATEMENT EXECUTE FUNCTION "infra"."reject_history_mutation"();
--> statement-breakpoint
CREATE TRIGGER reject_mutation_truncate BEFORE TRUNCATE ON "settlement"."cancellations"
 FOR EACH STATEMENT EXECUTE FUNCTION "infra"."reject_history_mutation"();
