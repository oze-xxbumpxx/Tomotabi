-- 検証用の最小planning表を具体化するDDL設計案。
-- 空の検証DBへ00_validation_prerequisites.sql、01_finance.sql適用後に実行する。
-- 既存データのバックフィル手順や本番マイグレーションではない。
BEGIN;
ALTER TABLE planning.trips
 ADD COLUMN name varchar(100) NOT NULL,
 ADD COLUMN starts_on date NOT NULL,
 ADD COLUMN ends_on date NOT NULL,
 ADD COLUMN status text NOT NULL DEFAULT 'planning' CHECK (status IN ('planning','traveling','finished')),
 ADD COLUMN version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
 ADD CONSTRAINT trip_name_nonempty CHECK (char_length(btrim(name)) > 0),
 ADD CONSTRAINT trip_period_valid CHECK (starts_on <= ends_on);

ALTER TABLE planning.plans
 ADD COLUMN name varchar(100) NOT NULL,
 ADD COLUMN kind text NOT NULL CHECK (kind IN ('place','food','shopping','lodging','transport')),
 ADD COLUMN planned_date date NOT NULL,
 ADD COLUMN planned_time time(0),
 ADD COLUMN memo varchar(2000),
 ADD COLUMN cancelled_at timestamptz,
 ADD COLUMN cancelled_by uuid,
 ADD COLUMN version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
 ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
 ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
 ADD CONSTRAINT plan_name_nonempty CHECK (char_length(btrim(name)) > 0),
 ADD CONSTRAINT plan_time_minute CHECK (planned_time IS NULL OR (planned_time < TIME '24:00' AND EXTRACT(SECOND FROM planned_time) = 0)),
 ADD CONSTRAINT plan_cancellation_pair CHECK ((cancelled_at IS NULL) = (cancelled_by IS NULL)),
 ADD CONSTRAINT plan_canceller_member FOREIGN KEY (trip_id,cancelled_by) REFERENCES planning.trip_participants(trip_id,user_id);
CREATE INDEX plans_day_idx ON planning.plans(trip_id,planned_date,planned_time,created_at,id);

CREATE TABLE record.plan_events (
 id uuid PRIMARY KEY,
 trip_id uuid NOT NULL,
 plan_id uuid NOT NULL,
 event_kind text NOT NULL CHECK (event_kind IN ('achievement','booking')),
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (trip_id,plan_id,event_kind,id),
 UNIQUE (trip_id,id),
 FOREIGN KEY (trip_id,plan_id) REFERENCES planning.plans(trip_id,id),
 FOREIGN KEY (trip_id,created_by) REFERENCES planning.trip_participants(trip_id,user_id)
);
CREATE INDEX plan_events_history_idx ON record.plan_events(trip_id,plan_id);
CREATE INDEX plan_events_timeline_idx ON record.plan_events(trip_id,created_at DESC,id DESC);

CREATE TABLE record.plan_event_cancellations (
 event_id uuid PRIMARY KEY,
 trip_id uuid NOT NULL,
 cancelled_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY (trip_id,event_id) REFERENCES record.plan_events(trip_id,id),
 FOREIGN KEY (trip_id,cancelled_by) REFERENCES planning.trip_participants(trip_id,user_id)
);
CREATE INDEX plan_event_cancellations_timeline_idx ON record.plan_event_cancellations(trip_id,created_at DESC,event_id DESC);

CREATE TABLE record.active_plan_events (
 trip_id uuid NOT NULL,
 plan_id uuid NOT NULL,
 event_kind text NOT NULL CHECK (event_kind IN ('achievement','booking')),
 event_id uuid NOT NULL UNIQUE,
 PRIMARY KEY (plan_id,event_kind),
 FOREIGN KEY (trip_id,plan_id,event_kind,event_id) REFERENCES record.plan_events(trip_id,plan_id,event_kind,id)
);
CREATE TRIGGER reject_mutation BEFORE UPDATE OR DELETE ON record.plan_events
 FOR EACH ROW EXECUTE FUNCTION infra.reject_history_mutation();
CREATE TRIGGER reject_mutation BEFORE UPDATE OR DELETE ON record.plan_event_cancellations
 FOR EACH ROW EXECUTE FUNCTION infra.reject_history_mutation();

-- 再送管理の種別を追加。ハッシュにはIf-Matchも含める。
-- 変更可能な予定・旅行の成功時DTOを保持し、後の変更後も元の結果を再送できるようにする。
ALTER TABLE infra.command_receipts ADD COLUMN response_body jsonb;
ALTER TABLE infra.command_receipts ADD CONSTRAINT mutable_resource_receipt_snapshot
 CHECK (resource_type NOT IN ('plan','trip') OR response_body IS NOT NULL);
ALTER TABLE infra.command_receipts DROP CONSTRAINT command_receipts_resource_type_check;
ALTER TABLE infra.command_receipts ADD CONSTRAINT command_receipts_resource_type_check CHECK
 (resource_type IN ('payment','payment_cancellation','preview','settlement','settlement_cancellation',
                   'plan','trip','plan_event','plan_event_cancellation'));
COMMIT;
