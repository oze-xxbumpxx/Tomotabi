-- 支払い・精算のDDL設計案。新規の空スキーマで適用する。
-- planning/identityの参照契約は00_validation_prerequisites.sql参照。
-- 業務上の同時実行・合計整合性は02_ORMとDB_API.mdのUnit of Workも必須。
BEGIN;
CREATE SCHEMA record;
CREATE SCHEMA settlement;
CREATE SCHEMA infra;

CREATE TABLE infra.trip_finance_guards (
    trip_id uuid PRIMARY KEY REFERENCES planning.trips(id),
    next_settlement_sequence bigint NOT NULL DEFAULT 1 CHECK (next_settlement_sequence > 0)
);

CREATE TABLE record.payments (
    id uuid PRIMARY KEY,
    trip_id uuid NOT NULL REFERENCES planning.trips(id),
    plan_id uuid,
    amount_yen bigint NOT NULL CHECK (amount_yen BETWEEN 1 AND 999999999),
    payer_slot smallint NOT NULL CHECK (payer_slot IN (0,1)),
    slot0_percent smallint NOT NULL CHECK (slot0_percent BETWEEN 0 AND 100),
    slot0_burden_yen bigint NOT NULL CHECK (slot0_burden_yen >= 0),
    slot1_burden_yen bigint NOT NULL CHECK (slot1_burden_yen >= 0),
    contribution_yen bigint NOT NULL,
    label varchar(100),
    created_by uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (trip_id, id),
    FOREIGN KEY (trip_id, plan_id) REFERENCES planning.plans(trip_id,id),
    FOREIGN KEY (trip_id, payer_slot) REFERENCES planning.trip_participants(trip_id,slot),
    FOREIGN KEY (trip_id, created_by) REFERENCES planning.trip_participants(trip_id,user_id),
    CHECK (label IS NULL OR char_length(btrim(label)) BETWEEN 1 AND 100),
    CHECK (slot0_burden_yen + slot1_burden_yen = amount_yen),
    CHECK (
        (payer_slot = 0 AND slot1_burden_yen = amount_yen * (100 - slot0_percent) / 100
                        AND contribution_yen = slot1_burden_yen)
        OR
        (payer_slot = 1 AND slot0_burden_yen = amount_yen * slot0_percent / 100
                        AND contribution_yen = -slot0_burden_yen)
    )
);
CREATE INDEX payments_trip_created_idx ON record.payments(trip_id, created_at DESC, id DESC);
CREATE INDEX payments_plan_idx ON record.payments(trip_id, plan_id) WHERE plan_id IS NOT NULL;

CREATE TABLE record.payment_cancellations (
    payment_id uuid PRIMARY KEY,
    trip_id uuid NOT NULL,
    cancelled_by uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (trip_id,payment_id) REFERENCES record.payments(trip_id,id),
    FOREIGN KEY (trip_id,cancelled_by) REFERENCES planning.trip_participants(trip_id,user_id)
);
CREATE INDEX payment_cancellations_trip_idx ON record.payment_cancellations(trip_id);

CREATE TABLE settlement.previews (
    id uuid PRIMARY KEY,
    trip_id uuid NOT NULL REFERENCES planning.trips(id),
    created_by uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    signed_total_yen bigint NOT NULL,
    UNIQUE (trip_id,id),
    FOREIGN KEY (trip_id,created_by) REFERENCES planning.trip_participants(trip_id,user_id)
);
CREATE INDEX previews_owner_idx ON settlement.previews(trip_id,created_by,created_at DESC,id DESC);

CREATE TABLE settlement.preview_items (
    preview_id uuid NOT NULL,
    trip_id uuid NOT NULL,
    payment_id uuid NOT NULL,
    kind text NOT NULL CHECK (kind IN ('BASE','REVERSAL')),
    contribution_yen bigint NOT NULL,
    base_settlement_id uuid,
    base_kind text NOT NULL DEFAULT 'BASE' CHECK (base_kind = 'BASE'),
    expected_claim_fingerprint varchar(64) NOT NULL CHECK (expected_claim_fingerprint ~ '^[0-9a-f]{64}$'),
    expected_cancelled boolean NOT NULL,
    PRIMARY KEY (preview_id,payment_id,kind),
    UNIQUE (trip_id,preview_id,payment_id,kind),
    UNIQUE (preview_id,payment_id),
    FOREIGN KEY (trip_id,preview_id) REFERENCES settlement.previews(trip_id,id),
    FOREIGN KEY (trip_id,payment_id) REFERENCES record.payments(trip_id,id),
    CHECK ((kind = 'BASE' AND base_settlement_id IS NULL AND NOT expected_cancelled)
        OR (kind = 'REVERSAL' AND base_settlement_id IS NOT NULL AND expected_cancelled))
);

CREATE TABLE settlement.settlements (
    id uuid PRIMARY KEY,
    trip_id uuid NOT NULL REFERENCES planning.trips(id),
    preview_id uuid NOT NULL UNIQUE,
    sequence bigint NOT NULL CHECK (sequence > 0),
    signed_total_yen bigint NOT NULL,
    completion_kind text NOT NULL CHECK (completion_kind IN ('transfer_completed','no_transfer_required')),
    created_by uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (trip_id,id),
    UNIQUE (trip_id,sequence),
    UNIQUE (trip_id,id,preview_id),
    FOREIGN KEY (trip_id,preview_id) REFERENCES settlement.previews(trip_id,id),
    FOREIGN KEY (trip_id,created_by) REFERENCES planning.trip_participants(trip_id,user_id),
    CHECK ((signed_total_yen = 0 AND completion_kind = 'no_transfer_required')
        OR (signed_total_yen <> 0 AND completion_kind = 'transfer_completed'))
);
CREATE INDEX settlements_latest_idx ON settlement.settlements(trip_id,sequence DESC);

CREATE TABLE settlement.items (
    settlement_id uuid NOT NULL,
    trip_id uuid NOT NULL,
    preview_id uuid NOT NULL,
    payment_id uuid NOT NULL,
    kind text NOT NULL CHECK (kind IN ('BASE','REVERSAL')),
    contribution_yen bigint NOT NULL,
    base_settlement_id uuid,
    base_kind text NOT NULL DEFAULT 'BASE' CHECK (base_kind = 'BASE'),
    PRIMARY KEY (settlement_id,payment_id,kind),
    UNIQUE (trip_id,settlement_id,payment_id,kind),
    UNIQUE (settlement_id,payment_id),
    FOREIGN KEY (trip_id,settlement_id,preview_id) REFERENCES settlement.settlements(trip_id,id,preview_id),
    FOREIGN KEY (trip_id,preview_id,payment_id,kind) REFERENCES settlement.preview_items(trip_id,preview_id,payment_id,kind),
    FOREIGN KEY (trip_id,payment_id) REFERENCES record.payments(trip_id,id),
    FOREIGN KEY (trip_id,base_settlement_id,payment_id,base_kind)
        REFERENCES settlement.items(trip_id,settlement_id,payment_id,kind),
    CHECK ((kind = 'BASE' AND base_settlement_id IS NULL)
        OR (kind = 'REVERSAL' AND base_settlement_id IS NOT NULL)),
    CHECK (base_settlement_id IS NULL OR base_settlement_id <> settlement_id)
);
CREATE INDEX settlement_items_payment_idx ON settlement.items(trip_id,payment_id,settlement_id);
ALTER TABLE settlement.preview_items ADD CONSTRAINT preview_reversal_base_fk
    FOREIGN KEY (trip_id,base_settlement_id,payment_id,base_kind)
    REFERENCES settlement.items(trip_id,settlement_id,payment_id,kind);

CREATE TABLE settlement.cancellations (
    settlement_id uuid PRIMARY KEY,
    trip_id uuid NOT NULL,
    cancelled_by uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (trip_id,settlement_id) REFERENCES settlement.settlements(trip_id,id),
    FOREIGN KEY (trip_id,cancelled_by) REFERENCES planning.trip_participants(trip_id,user_id)
);
CREATE INDEX settlement_cancellations_trip_idx ON settlement.cancellations(trip_id);

CREATE TABLE settlement.active_claims (
    trip_id uuid NOT NULL,
    payment_id uuid NOT NULL,
    kind text NOT NULL CHECK (kind IN ('BASE','REVERSAL')),
    settlement_id uuid NOT NULL,
    PRIMARY KEY (payment_id,kind),
    FOREIGN KEY (trip_id,settlement_id,payment_id,kind)
        REFERENCES settlement.items(trip_id,settlement_id,payment_id,kind)
);
CREATE INDEX active_claims_settlement_idx ON settlement.active_claims(trip_id,settlement_id);

CREATE TABLE infra.command_receipts (
    actor_id uuid NOT NULL REFERENCES identity.users(id),
    operation varchar(100) NOT NULL,
    idempotency_key uuid NOT NULL,
    trip_id uuid NOT NULL REFERENCES planning.trips(id),
    request_hash varchar(64) NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
    resource_type text NOT NULL CHECK (resource_type IN ('payment','payment_cancellation','preview','settlement','settlement_cancellation')),
    resource_id uuid NOT NULL,
    http_status smallint NOT NULL CHECK (http_status IN (200,201)),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (actor_id,operation,idempotency_key),
    FOREIGN KEY (trip_id,actor_id) REFERENCES planning.trip_participants(trip_id,user_id)
);

-- 履歴は追記のみ。通常のUPDATE/DELETEをDBでも拒否する。
-- 本番のアプリDBロールにはTRUNCATE/DDL/トリガー無効化権限を与えない。
CREATE FUNCTION infra.reject_history_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'append-only history cannot be updated or deleted' USING ERRCODE = '55000';
END;
$$;
DO $$
DECLARE relation_name text;
BEGIN
    FOREACH relation_name IN ARRAY ARRAY[
        'record.payments', 'record.payment_cancellations',
        'settlement.previews', 'settlement.preview_items',
        'settlement.settlements', 'settlement.items', 'settlement.cancellations',
        'infra.command_receipts'
    ] LOOP
        EXECUTE format('CREATE TRIGGER reject_mutation BEFORE UPDATE OR DELETE ON %s FOR EACH ROW EXECUTE FUNCTION infra.reject_history_mutation()', relation_name);
    END LOOP;
END;
$$;

-- このVIEWに整合性を丸投げしない。active_claimsを履歴と同じTXで保つことが前提。
CREATE VIEW settlement.pending_items AS
SELECT p.trip_id, p.id AS payment_id, 'BASE'::text AS kind,
       p.contribution_yen, NULL::uuid AS base_settlement_id
FROM record.payments p
LEFT JOIN record.payment_cancellations pc ON pc.payment_id=p.id
LEFT JOIN settlement.active_claims b ON b.payment_id=p.id AND b.kind='BASE'
WHERE pc.payment_id IS NULL AND b.payment_id IS NULL
UNION ALL
SELECT p.trip_id, p.id, 'REVERSAL'::text, -p.contribution_yen, b.settlement_id
FROM record.payments p
JOIN record.payment_cancellations pc ON pc.payment_id=p.id
JOIN settlement.active_claims b ON b.payment_id=p.id AND b.kind='BASE'
LEFT JOIN settlement.active_claims r ON r.payment_id=p.id AND r.kind='REVERSAL'
WHERE r.payment_id IS NULL;
COMMIT;
