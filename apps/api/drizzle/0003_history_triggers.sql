-- Append-only history guarantee (design "DB 設計 > 追記のみの保証", reference SQL 01/03).
-- The same function is reused for the M3 payment / settlement history tables.
CREATE FUNCTION "infra"."reject_history_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'append-only history cannot be updated or deleted' USING ERRCODE = '55000';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER reject_mutation BEFORE UPDATE OR DELETE ON "record"."plan_events"
 FOR EACH ROW EXECUTE FUNCTION "infra"."reject_history_mutation"();
--> statement-breakpoint
CREATE TRIGGER reject_mutation BEFORE UPDATE OR DELETE ON "record"."plan_event_cancellations"
 FOR EACH ROW EXECUTE FUNCTION "infra"."reject_history_mutation"();
