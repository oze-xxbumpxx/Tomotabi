import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createRoles,
  migrateAsMigrator,
  startPostgres,
  type TestDatabase,
} from "../support/database";

// Finance tables created by drizzle/0005_finance_tables.sql (reference spec
// docs/旅行アプリ設計3/詳細設計/sql/01_finance.sql, amount cap 9,999,999).
const FINANCE_TABLES = [
  "record.payments",
  "record.payment_cancellations",
  "settlement.previews",
  "settlement.preview_items",
  "settlement.settlements",
  "settlement.items",
  "settlement.cancellations",
  "settlement.active_claims",
] as const;

// Append-only tables: reject_history_mutation triggers (0006) and no UPDATE / DELETE
// grants for app_runtime (0007). settlement.active_claims is mutable occupancy state.
const HISTORY_TABLES = [
  "record.payments",
  "record.payment_cancellations",
  "settlement.previews",
  "settlement.preview_items",
  "settlement.settlements",
  "settlement.items",
  "settlement.cancellations",
] as const;

const FINGERPRINT = "a".repeat(64);

let db: TestDatabase;

async function insertUser(name: string): Promise<string> {
  const result = await db.admin.query<{ id: string }>(
    "INSERT INTO identity.users (name, email) VALUES ($1, $2) RETURNING id",
    [name, `${name}@example.test`],
  );
  return result.rows[0]!.id;
}

// A trip whose two participants are slot 0 / 1, with one plan and its finance guard row.
async function seedTrip(
  pool: Pool,
): Promise<{ tripId: string; planId: string; slot0: string; slot1: string }> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const slot0 = await insertUser(`hinata-${suffix}`);
  const slot1 = await insertUser(`aoi-${suffix}`);
  const trip = await pool.query<{ id: string }>(
    "INSERT INTO planning.trips (name, starts_on, ends_on, created_by) VALUES ('京都 2 泊', '2026-09-01', '2026-09-03', $1) RETURNING id",
    [slot0],
  );
  const tripId = trip.rows[0]!.id;
  await pool.query(
    "INSERT INTO planning.trip_participants (trip_id, slot, user_id) VALUES ($1, 0, $2), ($1, 1, $3)",
    [tripId, slot0, slot1],
  );
  const plan = await pool.query<{ id: string }>(
    "INSERT INTO planning.plans (trip_id, name, kind, planned_date) VALUES ($1, '清水寺', 'place', '2026-09-02') RETURNING id",
    [tripId],
  );
  await pool.query("INSERT INTO infra.trip_finance_guards (trip_id) VALUES ($1)", [tripId]);
  return { tripId, planId: plan.rows[0]!.id, slot0, slot1 };
}

// A trip with only a slot-0 participant (no slot 1), for the payer_slot FK.
async function seedSoloTrip(pool: Pool): Promise<{ tripId: string; slot0: string }> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const slot0 = await insertUser(`solo-${suffix}`);
  const trip = await pool.query<{ id: string }>(
    "INSERT INTO planning.trips (name, starts_on, ends_on, created_by) VALUES ('日帰り', '2026-10-01', '2026-10-01', $1) RETURNING id",
    [slot0],
  );
  const tripId = trip.rows[0]!.id;
  await pool.query(
    "INSERT INTO planning.trip_participants (trip_id, slot, user_id) VALUES ($1, 0, $2)",
    [tripId, slot0],
  );
  await pool.query("INSERT INTO infra.trip_finance_guards (trip_id) VALUES ($1)", [tripId]);
  return { tripId, slot0 };
}

// Valid payment: 7,001円, slot 0 paid, 50/50 -> burden 3,501 / 3,500, contribution +3,500.
async function insertPayment(
  pool: Pool,
  tripId: string,
  createdBy: string,
  planId: string | null = null,
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO record.payments
       (trip_id, plan_id, amount_yen, payer_slot, slot0_percent,
        slot0_burden_yen, slot1_burden_yen, contribution_yen, created_by)
     VALUES ($1, $2, 7001, 0, 50, 3501, 3500, 3500, $3) RETURNING id`,
    [tripId, planId, createdBy],
  );
  return result.rows[0]!.id;
}

// Valid BASE chain: preview -> preview_items(BASE) -> settlement -> items(BASE) -> active_claims.
async function settlePayment(
  pool: Pool,
  tripId: string,
  paymentId: string,
  createdBy: string,
  sequence: number,
): Promise<{ previewId: string; settlementId: string }> {
  const preview = await pool.query<{ id: string }>(
    `INSERT INTO settlement.previews (trip_id, created_by, signed_total_yen)
     VALUES ($1, $2, 3500) RETURNING id`,
    [tripId, createdBy],
  );
  const previewId = preview.rows[0]!.id;
  await pool.query(
    `INSERT INTO settlement.preview_items
       (preview_id, trip_id, payment_id, kind, contribution_yen, expected_claim_fingerprint, expected_cancelled)
     VALUES ($1, $2, $3, 'BASE', 3500, $4, false)`,
    [previewId, tripId, paymentId, FINGERPRINT],
  );
  const settlement = await pool.query<{ id: string }>(
    `INSERT INTO settlement.settlements
       (trip_id, preview_id, sequence, signed_total_yen, completion_kind, created_by)
     VALUES ($1, $2, $3, 3500, 'transfer_completed', $4) RETURNING id`,
    [tripId, previewId, sequence, createdBy],
  );
  const settlementId = settlement.rows[0]!.id;
  await pool.query(
    `INSERT INTO settlement.items
       (settlement_id, trip_id, preview_id, payment_id, kind, contribution_yen)
     VALUES ($1, $2, $3, $4, 'BASE', 3500)`,
    [settlementId, tripId, previewId, paymentId],
  );
  await pool.query(
    `INSERT INTO settlement.active_claims (trip_id, payment_id, kind, settlement_id)
     VALUES ($1, $2, 'BASE', $3)`,
    [tripId, paymentId, settlementId],
  );
  return { previewId, settlementId };
}

async function expectCheckViolation(promise: Promise<unknown>): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code: "23514" });
}

async function expectForeignKeyViolation(promise: Promise<unknown>): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code: "23503" });
}

async function expectPermissionDenied(pool: Pool, sql: string, params: unknown[] = []): Promise<void> {
  await expect(pool.query(sql, params)).rejects.toMatchObject({ code: "42501" });
}

describe("finance schema (record.payments and the settlement schema)", () => {
  let runtime: Pool;
  let migrator: Pool;

  beforeAll(async () => {
    db = await startPostgres();
    await createRoles(db);
    await migrateAsMigrator(db);
    runtime = db.poolFor("app_runtime");
    migrator = db.poolFor("migrator");
  }, 120_000);

  afterAll(async () => {
    await db?.stop();
  });

  it("creates the 8 finance tables, indexes and append-only triggers from the migrations", async () => {
    const tables = await db.admin.query<{ name: string }>(
      `SELECT table_schema || '.' || table_name AS name FROM information_schema.tables
        WHERE table_schema = 'settlement'
           OR (table_schema = 'record' AND table_name IN ('payments', 'payment_cancellations'))
        ORDER BY name`,
    );
    expect(tables.rows.map((row) => row.name)).toEqual([...FINANCE_TABLES].sort());

    const indexes = await db.admin.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE schemaname IN ('record', 'settlement')`,
    );
    expect(indexes.rows.map((row) => row.indexname)).toEqual(
      expect.arrayContaining([
        "payments_trip_created_idx",
        "payments_plan_idx",
        "payment_cancellations_trip_idx",
        "previews_owner_idx",
        "settlements_latest_idx",
        "settlement_items_payment_idx",
        "settlement_cancellations_trip_idx",
        "active_claims_settlement_idx",
      ]),
    );

    const triggers = await db.admin.query<{ name: string }>(
      `SELECT DISTINCT event_object_schema || '.' || event_object_table AS name
         FROM information_schema.triggers
        WHERE trigger_name = 'reject_mutation'
          AND event_object_schema IN ('record', 'settlement')
        ORDER BY name`,
    );
    // plan_events / plan_event_cancellations already carry the same trigger from 0003.
    const expected = [...HISTORY_TABLES, "record.plan_events", "record.plan_event_cancellations"].sort();
    expect(triggers.rows.map((row) => row.name)).toEqual(expected);
  });

  describe("FD-01 CHECK constraints", () => {
    let tripId: string;
    let planId: string;
    let slot0: string;

    const insertRawPayment = (columns: Record<string, string | number | null>) => {
      const row = {
        trip_id: tripId,
        plan_id: null as string | null,
        amount_yen: "7001",
        payer_slot: 0,
        slot0_percent: 50,
        slot0_burden_yen: "3501",
        slot1_burden_yen: "3500",
        contribution_yen: "3500",
        created_by: slot0,
        label: null as string | null,
        ...columns,
      };
      return runtime.query(
        `INSERT INTO record.payments
           (trip_id, plan_id, amount_yen, payer_slot, slot0_percent,
            slot0_burden_yen, slot1_burden_yen, contribution_yen, created_by, label)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          row.trip_id,
          row.plan_id,
          row.amount_yen,
          row.payer_slot,
          row.slot0_percent,
          row.slot0_burden_yen,
          row.slot1_burden_yen,
          row.contribution_yen,
          row.created_by,
          row.label,
        ],
      );
    };

    beforeAll(async () => {
      ({ tripId, planId, slot0 } = await seedTrip(runtime));
    });

    it("accepts a valid payment, including the 9,999,999 円 cap and a 100-char label", async () => {
      await insertRawPayment({ plan_id: planId, label: "ランチ".padEnd(100, "x") });
      const maxed = await insertRawPayment({
        amount_yen: "9999999",
        payer_slot: 1,
        slot0_percent: 0,
        slot0_burden_yen: "0",
        slot1_burden_yen: "9999999",
        contribution_yen: "0",
      });
      expect(maxed.rowCount).toBe(1);
    });

    it.each([
      ["amount 0", { amount_yen: "0", slot0_burden_yen: "0", slot1_burden_yen: "0", contribution_yen: "0" }],
      ["amount 10,000,000", { amount_yen: "10000000", slot0_burden_yen: "5000000", slot1_burden_yen: "5000000", contribution_yen: "5000000" }],
      ["slot0_percent 101", { slot0_percent: 101 }],
      ["burden sum different from amount", { slot0_burden_yen: "3500" }],
      ["contribution different from the payer-0 formula", { contribution_yen: "0" }],
      [
        "burden shape inconsistent with the payer-1 formula",
        { payer_slot: 1, slot0_burden_yen: "3501", slot1_burden_yen: "3500", contribution_yen: "-3500" },
      ],
      ["whitespace-only label", { label: "   " }],
    ])("rejects %s", async (_label, columns) => {
      await expectCheckViolation(insertRawPayment(columns));
    });

    it("rejects a negative burden", async () => {
      await expectCheckViolation(
        insertRawPayment({ slot0_burden_yen: "-1", slot1_burden_yen: "7002", contribution_yen: "3500" }),
      );
    });
  });

  describe("FD-01 settlement CHECK constraints", () => {
    let tripId: string;
    let slot0: string;
    let paymentId: string;
    let previewId: string;
    let settlementId: string;

    beforeAll(async () => {
      ({ tripId, slot0 } = await seedTrip(runtime));
      paymentId = await insertPayment(runtime, tripId, slot0);
      ({ previewId, settlementId } = await settlePayment(runtime, tripId, paymentId, slot0, 1));
    });

    it("rejects a BASE preview item that claims cancellation, and a REVERSAL without a base", async () => {
      const otherPayment = await insertPayment(runtime, tripId, slot0);
      const otherPreview = await runtime.query<{ id: string }>(
        `INSERT INTO settlement.previews (trip_id, created_by, signed_total_yen)
         VALUES ($1, $2, 3500) RETURNING id`,
        [tripId, slot0],
      );
      const otherPreviewId = otherPreview.rows[0]!.id;

      await expectCheckViolation(
        runtime.query(
          `INSERT INTO settlement.preview_items
             (preview_id, trip_id, payment_id, kind, contribution_yen, expected_claim_fingerprint, expected_cancelled)
           VALUES ($1, $2, $3, 'BASE', 3500, $4, true)`,
          [otherPreviewId, tripId, otherPayment, FINGERPRINT],
        ),
      );
      await expectCheckViolation(
        runtime.query(
          `INSERT INTO settlement.preview_items
             (preview_id, trip_id, payment_id, kind, contribution_yen, expected_claim_fingerprint, expected_cancelled)
           VALUES ($1, $2, $3, 'REVERSAL', -3500, $4, true)`,
          [otherPreviewId, tripId, otherPayment, FINGERPRINT],
        ),
      );
      await expectCheckViolation(
        runtime.query(
          `INSERT INTO settlement.preview_items
             (preview_id, trip_id, payment_id, kind, contribution_yen, expected_claim_fingerprint, expected_cancelled)
           VALUES ($1, $2, $3, 'BASE', 3500, 'not-a-fingerprint', false)`,
          [otherPreviewId, tripId, otherPayment],
        ),
      );
    });

    it("rejects a settlement with sequence 0 or a mismatched completion_kind", async () => {
      const preview = await runtime.query<{ id: string }>(
        `INSERT INTO settlement.previews (trip_id, created_by, signed_total_yen)
         VALUES ($1, $2, 0) RETURNING id`,
        [tripId, slot0],
      );
      const zeroPreviewId = preview.rows[0]!.id;
      await expectCheckViolation(
        runtime.query(
          `INSERT INTO settlement.settlements
             (trip_id, preview_id, sequence, signed_total_yen, completion_kind, created_by)
           VALUES ($1, $2, 0, 0, 'no_transfer_required', $3)`,
          [tripId, zeroPreviewId, slot0],
        ),
      );
      await expectCheckViolation(
        runtime.query(
          `INSERT INTO settlement.settlements
             (trip_id, preview_id, sequence, signed_total_yen, completion_kind, created_by)
           VALUES ($1, $2, 1, 0, 'transfer_completed', $3)`,
          [tripId, zeroPreviewId, slot0],
        ),
      );
    });

    it("rejects a BASE item with a base or a REVERSAL item without one", async () => {
      const otherPayment = await insertPayment(runtime, tripId, slot0);
      const preview = await runtime.query<{ id: string }>(
        `INSERT INTO settlement.previews (trip_id, created_by, signed_total_yen)
         VALUES ($1, $2, 3500) RETURNING id`,
        [tripId, slot0],
      );
      const newPreviewId = preview.rows[0]!.id;
      await runtime.query(
        `INSERT INTO settlement.preview_items
           (preview_id, trip_id, payment_id, kind, contribution_yen, expected_claim_fingerprint, expected_cancelled)
         VALUES ($1, $2, $3, 'BASE', 3500, $4, false)`,
        [newPreviewId, tripId, otherPayment, FINGERPRINT],
      );
      const settlement = await runtime.query<{ id: string }>(
        `INSERT INTO settlement.settlements
           (trip_id, preview_id, sequence, signed_total_yen, completion_kind, created_by)
         VALUES ($1, $2, 2, 3500, 'transfer_completed', $3) RETURNING id`,
        [tripId, newPreviewId, slot0],
      );
      const newSettlementId = settlement.rows[0]!.id;

      await expectCheckViolation(
        runtime.query(
          `INSERT INTO settlement.items
             (settlement_id, trip_id, preview_id, payment_id, kind, contribution_yen, base_settlement_id)
           VALUES ($1, $2, $3, $4, 'BASE', 3500, $5)`,
          [newSettlementId, tripId, newPreviewId, otherPayment, settlementId],
        ),
      );
      await expectCheckViolation(
        runtime.query(
          `INSERT INTO settlement.items
             (settlement_id, trip_id, preview_id, payment_id, kind, contribution_yen)
           VALUES ($1, $2, $3, $4, 'REVERSAL', -3500)`,
          [newSettlementId, tripId, newPreviewId, otherPayment],
        ),
      );
    });

    it("accepts a REVERSAL chain once the payment is cancelled", async () => {
      const otherPayment = await insertPayment(runtime, tripId, slot0);
      const base = await settlePayment(runtime, tripId, otherPayment, slot0, 10);
      await runtime.query(
        "INSERT INTO record.payment_cancellations (payment_id, trip_id, cancelled_by) VALUES ($1, $2, $3)",
        [otherPayment, tripId, slot0],
      );

      const preview = await runtime.query<{ id: string }>(
        `INSERT INTO settlement.previews (trip_id, created_by, signed_total_yen)
         VALUES ($1, $2, -3500) RETURNING id`,
        [tripId, slot0],
      );
      const reversalPreviewId = preview.rows[0]!.id;
      await runtime.query(
        `INSERT INTO settlement.preview_items
           (preview_id, trip_id, payment_id, kind, contribution_yen, base_settlement_id, expected_claim_fingerprint, expected_cancelled)
         VALUES ($1, $2, $3, 'REVERSAL', -3500, $4, $5, true)`,
        [reversalPreviewId, tripId, otherPayment, base.settlementId, FINGERPRINT],
      );
      const settlement = await runtime.query<{ id: string }>(
        `INSERT INTO settlement.settlements
           (trip_id, preview_id, sequence, signed_total_yen, completion_kind, created_by)
         VALUES ($1, $2, 11, -3500, 'transfer_completed', $3) RETURNING id`,
        [tripId, reversalPreviewId, slot0],
      );
      const reversalSettlementId = settlement.rows[0]!.id;
      await runtime.query(
        `INSERT INTO settlement.items
           (settlement_id, trip_id, preview_id, payment_id, kind, contribution_yen, base_settlement_id)
         VALUES ($1, $2, $3, $4, 'REVERSAL', -3500, $5)`,
        [reversalSettlementId, tripId, reversalPreviewId, otherPayment, base.settlementId],
      );
      await runtime.query(
        `INSERT INTO settlement.active_claims (trip_id, payment_id, kind, settlement_id)
         VALUES ($1, $2, 'REVERSAL', $3)`,
        [tripId, otherPayment, reversalSettlementId],
      );
    });

    it("rejects a REVERSAL preview item whose base is another payment's settlement", async () => {
      // preview_reversal_base_fk: (trip_id, base_settlement_id, payment_id, 'BASE') must
      // match an items row, so the base must be a settlement of the same payment.
      const otherPayment = await insertPayment(runtime, tripId, slot0);
      const other = await settlePayment(runtime, tripId, otherPayment, slot0, 50);
      const preview = await runtime.query<{ id: string }>(
        `INSERT INTO settlement.previews (trip_id, created_by, signed_total_yen)
         VALUES ($1, $2, -3500) RETURNING id`,
        [tripId, slot0],
      );
      const revPreviewId = preview.rows[0]!.id;
      await expectForeignKeyViolation(
        runtime.query(
          `INSERT INTO settlement.preview_items
             (preview_id, trip_id, payment_id, kind, contribution_yen, base_settlement_id, expected_claim_fingerprint, expected_cancelled)
           VALUES ($1, $2, $3, 'REVERSAL', -3500, $4, $5, true)`,
          [revPreviewId, tripId, paymentId, other.settlementId, FINGERPRINT],
        ),
      );
    });

    it("rejects settlement items that break the reversal base or kind linkage", async () => {
      // items -> preview_items (trip_id, preview_id, payment_id, kind),
      // items_reversal_base_fk and items_no_self_base.
      const preview = await runtime.query<{ id: string }>(
        `INSERT INTO settlement.previews (trip_id, created_by, signed_total_yen)
         VALUES ($1, $2, -3500) RETURNING id`,
        [tripId, slot0],
      );
      const revPreviewId = preview.rows[0]!.id;
      await runtime.query(
        `INSERT INTO settlement.preview_items
           (preview_id, trip_id, payment_id, kind, contribution_yen, base_settlement_id, expected_claim_fingerprint, expected_cancelled)
         VALUES ($1, $2, $3, 'REVERSAL', -3500, $4, $5, true)`,
        [revPreviewId, tripId, paymentId, settlementId, FINGERPRINT],
      );
      const settlement = await runtime.query<{ id: string }>(
        `INSERT INTO settlement.settlements
           (trip_id, preview_id, sequence, signed_total_yen, completion_kind, created_by)
         VALUES ($1, $2, 60, -3500, 'transfer_completed', $3) RETURNING id`,
        [tripId, revPreviewId, slot0],
      );
      const revSettlementId = settlement.rows[0]!.id;

      // The preview item is REVERSAL, so a BASE item has no matching preview item.
      await expectForeignKeyViolation(
        runtime.query(
          `INSERT INTO settlement.items
             (settlement_id, trip_id, preview_id, payment_id, kind, contribution_yen)
           VALUES ($1, $2, $3, $4, 'BASE', 3500)`,
          [revSettlementId, tripId, revPreviewId, paymentId],
        ),
      );
      // The base settlement settled a different payment: no BASE item for this one.
      const otherPayment = await insertPayment(runtime, tripId, slot0);
      const other = await settlePayment(runtime, tripId, otherPayment, slot0, 61);
      await expectForeignKeyViolation(
        runtime.query(
          `INSERT INTO settlement.items
             (settlement_id, trip_id, preview_id, payment_id, kind, contribution_yen, base_settlement_id)
           VALUES ($1, $2, $3, $4, 'REVERSAL', -3500, $5)`,
          [revSettlementId, tripId, revPreviewId, paymentId, other.settlementId],
        ),
      );
      // A settlement cannot be the base of its own items.
      await expectCheckViolation(
        runtime.query(
          `INSERT INTO settlement.items
             (settlement_id, trip_id, preview_id, payment_id, kind, contribution_yen, base_settlement_id)
           VALUES ($1, $2, $3, $4, 'REVERSAL', -3500, $5)`,
          [revSettlementId, tripId, revPreviewId, paymentId, revSettlementId],
        ),
      );
    });

    it("rejects a second row for the same payment inside one preview or settlement", async () => {
      // preview_items (preview_id, payment_id) and items (settlement_id, payment_id) are
      // unique: a payment appears at most once per preview/settlement whatever the kind.
      // If the preview_items unique were missing, the items unique rejects instead.
      const attempt = async () => {
        await runtime.query(
          `INSERT INTO settlement.preview_items
             (preview_id, trip_id, payment_id, kind, contribution_yen, base_settlement_id, expected_claim_fingerprint, expected_cancelled)
           VALUES ($1, $2, $3, 'REVERSAL', -3500, $4, $5, true)`,
          [previewId, tripId, paymentId, settlementId, FINGERPRINT],
        );
        await runtime.query(
          `INSERT INTO settlement.items
             (settlement_id, trip_id, preview_id, payment_id, kind, contribution_yen, base_settlement_id)
           VALUES ($1, $2, $3, $4, 'REVERSAL', -3500, $5)`,
          [settlementId, tripId, previewId, paymentId, settlementId],
        );
      };
      await expect(attempt()).rejects.toMatchObject({ code: "23505" });
    });

    it("rejects a second settlement for the same preview and a duplicate claim", async () => {
      await expect(
        runtime.query(
          `INSERT INTO settlement.settlements
             (trip_id, preview_id, sequence, signed_total_yen, completion_kind, created_by)
           VALUES ($1, $2, 20, 3500, 'transfer_completed', $3)`,
          [tripId, previewId, slot0],
        ),
      ).rejects.toMatchObject({ code: "23505" });
      await expect(
        runtime.query(
          `INSERT INTO settlement.settlements
             (trip_id, preview_id, sequence, signed_total_yen, completion_kind, created_by)
           VALUES ($1, $2, 1, 3500, 'transfer_completed', $3)`,
          [
            tripId,
            (await runtime.query<{ id: string }>(
              `INSERT INTO settlement.previews (trip_id, created_by, signed_total_yen)
               VALUES ($1, $2, 3500) RETURNING id`,
              [tripId, slot0],
            )).rows[0]!.id,
            slot0,
          ],
        ),
      ).rejects.toMatchObject({ code: "23505" });
      await expect(
        runtime.query(
          `INSERT INTO settlement.active_claims (trip_id, payment_id, kind, settlement_id)
           VALUES ($1, $2, 'BASE', $3)`,
          [tripId, paymentId, settlementId],
        ),
      ).rejects.toMatchObject({ code: "23505" });
    });
  });

  describe("FD-02 rows cannot mix two trips", () => {
    let tripA: { tripId: string; planId: string; slot0: string; slot1: string };
    let tripB: { tripId: string; planId: string; slot0: string; slot1: string };
    let paymentA: string;
    let settlementA: string;

    beforeAll(async () => {
      tripA = await seedTrip(runtime);
      tripB = await seedTrip(runtime);
      paymentA = await insertPayment(runtime, tripA.tripId, tripA.slot0, tripA.planId);
      ({ settlementId: settlementA } = await settlePayment(runtime, tripA.tripId, paymentA, tripA.slot0, 1));
    });

    it("rejects a payment in trip B that references trip A's plan or a non-participant", async () => {
      await expectForeignKeyViolation(
        runtime.query(
          `INSERT INTO record.payments
             (trip_id, plan_id, amount_yen, payer_slot, slot0_percent,
              slot0_burden_yen, slot1_burden_yen, contribution_yen, created_by)
           VALUES ($1, $2, 7001, 0, 50, 3501, 3500, 3500, $3)`,
          [tripB.tripId, tripA.planId, tripB.slot0],
        ),
      );
      await expectForeignKeyViolation(
        runtime.query(
          `INSERT INTO record.payments
             (trip_id, amount_yen, payer_slot, slot0_percent,
              slot0_burden_yen, slot1_burden_yen, contribution_yen, created_by)
           VALUES ($1, 7001, 0, 50, 3501, 3500, 3500, $2)`,
          [tripB.tripId, tripA.slot0],
        ),
      );
    });

    it("rejects cancellations, preview items, settlement items and claims that cross trips", async () => {
      await expectForeignKeyViolation(
        runtime.query(
          "INSERT INTO record.payment_cancellations (payment_id, trip_id, cancelled_by) VALUES ($1, $2, $3)",
          [paymentA, tripB.tripId, tripB.slot0],
        ),
      );

      const previewB = await runtime.query<{ id: string }>(
        `INSERT INTO settlement.previews (trip_id, created_by, signed_total_yen)
         VALUES ($1, $2, 3500) RETURNING id`,
        [tripB.tripId, tripB.slot0],
      );
      const previewBId = previewB.rows[0]!.id;
      await expectForeignKeyViolation(
        runtime.query(
          `INSERT INTO settlement.preview_items
             (preview_id, trip_id, payment_id, kind, contribution_yen, expected_claim_fingerprint, expected_cancelled)
           VALUES ($1, $2, $3, 'BASE', 3500, $4, false)`,
          [previewBId, tripB.tripId, paymentA, FINGERPRINT],
        ),
      );

      const paymentB = await insertPayment(runtime, tripB.tripId, tripB.slot0);
      await runtime.query(
        `INSERT INTO settlement.preview_items
           (preview_id, trip_id, payment_id, kind, contribution_yen, expected_claim_fingerprint, expected_cancelled)
         VALUES ($1, $2, $3, 'BASE', 3500, $4, false)`,
        [previewBId, tripB.tripId, paymentB, FINGERPRINT],
      );
      const settlementB = await runtime.query<{ id: string }>(
        `INSERT INTO settlement.settlements
           (trip_id, preview_id, sequence, signed_total_yen, completion_kind, created_by)
         VALUES ($1, $2, 1, 3500, 'transfer_completed', $3) RETURNING id`,
        [tripB.tripId, previewBId, tripB.slot0],
      );
      const settlementBId = settlementB.rows[0]!.id;

      await expectForeignKeyViolation(
        runtime.query(
          `INSERT INTO settlement.items
             (settlement_id, trip_id, preview_id, payment_id, kind, contribution_yen)
           VALUES ($1, $2, $3, $4, 'BASE', 3500)`,
          [settlementBId, tripB.tripId, previewBId, paymentA],
        ),
      );

      await runtime.query(
        `INSERT INTO settlement.items
           (settlement_id, trip_id, preview_id, payment_id, kind, contribution_yen)
         VALUES ($1, $2, $3, $4, 'BASE', 3500)`,
        [settlementBId, tripB.tripId, previewBId, paymentB],
      );

      await expectForeignKeyViolation(
        runtime.query(
          `INSERT INTO settlement.active_claims (trip_id, payment_id, kind, settlement_id)
           VALUES ($1, $2, 'BASE', $3)`,
          [tripB.tripId, paymentB, settlementA],
        ),
      );
      await expectForeignKeyViolation(
        runtime.query(
          `INSERT INTO settlement.cancellations (settlement_id, trip_id, cancelled_by)
           VALUES ($1, $2, $3)`,
          [settlementA, tripB.tripId, tripB.slot0],
        ),
      );
    });

    it("rejects a payment whose payer_slot has no participant in the trip", async () => {
      // payments (trip_id, payer_slot) -> trip_participants (trip_id, slot):
      // a trip with only a slot-0 participant cannot record a slot-1 payer.
      const solo = await seedSoloTrip(runtime);
      await expectForeignKeyViolation(
        runtime.query(
          `INSERT INTO record.payments
             (trip_id, amount_yen, payer_slot, slot0_percent,
              slot0_burden_yen, slot1_burden_yen, contribution_yen, created_by)
           VALUES ($1, 7001, 1, 50, 3500, 3501, -3500, $2)`,
          [solo.tripId, solo.slot0],
        ),
      );
    });
  });

  describe("FD-03 append-only history", () => {
    let tripId: string;
    let slot0: string;
    let paymentId: string;
    let settlementId: string;
    let previewId: string;

    beforeAll(async () => {
      ({ tripId, slot0 } = await seedTrip(runtime));
      paymentId = await insertPayment(runtime, tripId, slot0);
      ({ previewId, settlementId } = await settlePayment(runtime, tripId, paymentId, slot0, 1));
      await runtime.query(
        "INSERT INTO record.payment_cancellations (payment_id, trip_id, cancelled_by) VALUES ($1, $2, $3)",
        [paymentId, tripId, slot0],
      );
      await runtime.query(
        "INSERT INTO settlement.cancellations (settlement_id, trip_id, cancelled_by) VALUES ($1, $2, $3)",
        [settlementId, tripId, slot0],
      );
    });

    it.each([...HISTORY_TABLES])("rejects UPDATE and DELETE on %s even as migrator", async (table) => {
      const [schema, name] = table.split(".");
      const pk = {
        payments: "id",
        payment_cancellations: "payment_id",
        previews: "id",
        settlements: "id",
        cancellations: "settlement_id",
        preview_items: "preview_id",
        items: "settlement_id",
      }[name]!;
      const pkValue = {
        payments: paymentId,
        payment_cancellations: paymentId,
        previews: previewId,
        settlements: settlementId,
        cancellations: settlementId,
        preview_items: previewId,
        items: settlementId,
      }[name]!;
      await expect(
        migrator.query(`UPDATE ${schema}.${name} SET ${pk} = ${pk} WHERE ${pk} = $1`, [pkValue]),
      ).rejects.toMatchObject({ code: "55000" });
      await expect(
        migrator.query(`DELETE FROM ${schema}.${name} WHERE ${pk} = $1`, [pkValue]),
      ).rejects.toMatchObject({ code: "55000" });
    });

    it("allows DELETE on settlement.active_claims (occupancy is mutable)", async () => {
      const deleted = await runtime.query(
        "DELETE FROM settlement.active_claims WHERE payment_id = $1 AND kind = 'BASE' AND settlement_id = $2",
        [paymentId, settlementId],
      );
      expect(deleted.rowCount).toBe(1);
    });
  });

  describe("FD-04 app_runtime privileges", () => {
    let tripId: string;

    beforeAll(async () => {
      ({ tripId } = await seedTrip(runtime));
    });

    it("can SELECT every finance table", async () => {
      for (const table of FINANCE_TABLES) {
        await runtime.query(`SELECT count(*) FROM ${table}`);
      }
    });

    it("cannot UPDATE or DELETE history tables", async () => {
      for (const table of HISTORY_TABLES) {
        await expectPermissionDenied(runtime, `UPDATE ${table} SET trip_id = trip_id`);
        await expectPermissionDenied(runtime, `DELETE FROM ${table}`);
      }
    });

    it("cannot UPDATE settlement.active_claims (SELECT, INSERT, DELETE only)", async () => {
      await expectPermissionDenied(
        runtime,
        "UPDATE settlement.active_claims SET settlement_id = settlement_id",
      );
    });

    it("cannot TRUNCATE any finance table", async () => {
      for (const table of FINANCE_TABLES) {
        await expectPermissionDenied(runtime, `TRUNCATE ${table}`);
      }
    });

    it("can hand out the settlement sequence and lock the guard row", async () => {
      await runtime.query(
        "UPDATE infra.trip_finance_guards SET next_settlement_sequence = 2 WHERE trip_id = $1",
        [tripId],
      );
      const client = await runtime.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          "SELECT trip_id FROM infra.trip_finance_guards WHERE trip_id = $1 FOR UPDATE",
          [tripId],
        );
        await client.query("COMMIT");
      } finally {
        client.release();
      }
      await expectPermissionDenied(
        runtime,
        "UPDATE infra.trip_finance_guards SET trip_id = $1 WHERE trip_id = $1",
        [tripId],
      );
    });

    it("cannot run DDL in the settlement schema", async () => {
      await expectPermissionDenied(runtime, "CREATE TABLE settlement.intruder (id int)");
      await expectPermissionDenied(runtime, "DROP TABLE settlement.settlements");
    });
  });
});
