import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
  type PgTableExtraConfigValue,
} from "drizzle-orm/pg-core";
import { tripParticipants, trips } from "./planning";
import { payments } from "./record";

// Reference spec: docs/旅行アプリ設計 3/詳細設計/sql/01_finance.sql
// previews, preview_items, settlements, items and cancellations are append-only; the
// BEFORE UPDATE OR DELETE triggers live in a custom migration (drizzle/0006_finance_triggers.sql).
// active_claims is mutable occupancy state, kept in the same transaction as the history rows
// (the reference spec's settlement.pending_items VIEW is intentionally not created).
export const settlement = pgSchema("settlement");

const withTimezone = { withTimezone: true } as const;

const createdAt = () => timestamp("created_at", withTimezone).defaultNow().notNull();

export const previews = settlement.table(
  "previews",
  {
    id: uuid("id").default(sql`pg_catalog.gen_random_uuid()`).primaryKey(),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id),
    createdBy: uuid("created_by").notNull(),
    createdAt: createdAt(),
    signedTotalYen: bigint("signed_total_yen", { mode: "bigint" }).notNull(),
  },
  (table) => [
    unique("previews_trip_id_id_unique").on(table.tripId, table.id),
    foreignKey({
      columns: [table.tripId, table.createdBy],
      foreignColumns: [tripParticipants.tripId, tripParticipants.userId],
    }),
    index("previews_owner_idx").on(
      table.tripId,
      table.createdBy,
      table.createdAt.desc(),
      table.id.desc(),
    ),
  ],
);

export const previewItems = settlement.table(
  "preview_items",
  {
    previewId: uuid("preview_id").notNull(),
    tripId: uuid("trip_id").notNull(),
    paymentId: uuid("payment_id").notNull(),
    kind: text("kind").notNull(),
    contributionYen: bigint("contribution_yen", { mode: "bigint" }).notNull(),
    baseSettlementId: uuid("base_settlement_id"),
    baseKind: text("base_kind").default("BASE").notNull(),
    expectedClaimFingerprint: varchar("expected_claim_fingerprint", { length: 64 }).notNull(),
    expectedCancelled: boolean("expected_cancelled").notNull(),
  },
  (table): PgTableExtraConfigValue[] => [
    primaryKey({ columns: [table.previewId, table.paymentId, table.kind] }),
    unique("preview_items_trip_id_preview_id_payment_id_kind_unique").on(
      table.tripId,
      table.previewId,
      table.paymentId,
      table.kind,
    ),
    unique("preview_items_preview_id_payment_id_unique").on(table.previewId, table.paymentId),
    check("preview_items_kind_check", sql`${table.kind} IN ('BASE', 'REVERSAL')`),
    check("preview_items_base_kind_check", sql`${table.baseKind} = 'BASE'`),
    check(
      "preview_items_expected_claim_fingerprint_check",
      sql`${table.expectedClaimFingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "preview_items_reversal_shape",
      sql`(${table.kind} = 'BASE' AND ${table.baseSettlementId} IS NULL AND NOT ${table.expectedCancelled})
          OR (${table.kind} = 'REVERSAL' AND ${table.baseSettlementId} IS NOT NULL AND ${table.expectedCancelled})`,
    ),
    foreignKey({
      columns: [table.tripId, table.previewId],
      foreignColumns: [previews.tripId, previews.id],
    }),
    foreignKey({
      columns: [table.tripId, table.paymentId],
      foreignColumns: [payments.tripId, payments.id],
    }),
    foreignKey({
      name: "preview_reversal_base_fk",
      columns: [table.tripId, table.baseSettlementId, table.paymentId, table.baseKind],
      foreignColumns: [
        settlementItems.tripId,
        settlementItems.settlementId,
        settlementItems.paymentId,
        settlementItems.kind,
      ],
    }),
  ],
);

export const settlements = settlement.table(
  "settlements",
  {
    id: uuid("id").default(sql`pg_catalog.gen_random_uuid()`).primaryKey(),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id),
    previewId: uuid("preview_id").notNull().unique("settlements_preview_id_unique"),
    sequence: bigint("sequence", { mode: "number" }).notNull(),
    signedTotalYen: bigint("signed_total_yen", { mode: "bigint" }).notNull(),
    completionKind: text("completion_kind").notNull(),
    createdBy: uuid("created_by").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    unique("settlements_trip_id_id_unique").on(table.tripId, table.id),
    unique("settlements_trip_id_sequence_unique").on(table.tripId, table.sequence),
    unique("settlements_trip_id_id_preview_id_unique").on(table.tripId, table.id, table.previewId),
    check("settlements_sequence_check", sql`${table.sequence} > 0`),
    check(
      "settlements_completion_kind_check",
      sql`${table.completionKind} IN ('transfer_completed', 'no_transfer_required')`,
    ),
    check(
      "settlements_completion_total",
      sql`(${table.signedTotalYen} = 0 AND ${table.completionKind} = 'no_transfer_required')
          OR (${table.signedTotalYen} <> 0 AND ${table.completionKind} = 'transfer_completed')`,
    ),
    foreignKey({
      columns: [table.tripId, table.previewId],
      foreignColumns: [previews.tripId, previews.id],
    }),
    foreignKey({
      columns: [table.tripId, table.createdBy],
      foreignColumns: [tripParticipants.tripId, tripParticipants.userId],
    }),
    index("settlements_latest_idx").on(table.tripId, table.sequence.desc()),
  ],
);

export const settlementItems = settlement.table(
  "items",
  {
    settlementId: uuid("settlement_id").notNull(),
    tripId: uuid("trip_id").notNull(),
    previewId: uuid("preview_id").notNull(),
    paymentId: uuid("payment_id").notNull(),
    kind: text("kind").notNull(),
    contributionYen: bigint("contribution_yen", { mode: "bigint" }).notNull(),
    baseSettlementId: uuid("base_settlement_id"),
    baseKind: text("base_kind").default("BASE").notNull(),
  },
  (table): PgTableExtraConfigValue[] => [
    primaryKey({ columns: [table.settlementId, table.paymentId, table.kind] }),
    unique("items_trip_id_settlement_id_payment_id_kind_unique").on(
      table.tripId,
      table.settlementId,
      table.paymentId,
      table.kind,
    ),
    unique("items_settlement_id_payment_id_unique").on(table.settlementId, table.paymentId),
    check("items_kind_check", sql`${table.kind} IN ('BASE', 'REVERSAL')`),
    check("items_base_kind_check", sql`${table.baseKind} = 'BASE'`),
    check(
      "items_reversal_shape",
      sql`(${table.kind} = 'BASE' AND ${table.baseSettlementId} IS NULL)
          OR (${table.kind} = 'REVERSAL' AND ${table.baseSettlementId} IS NOT NULL)`,
    ),
    check(
      "items_no_self_base",
      sql`${table.baseSettlementId} IS NULL OR ${table.baseSettlementId} <> ${table.settlementId}`,
    ),
    foreignKey({
      columns: [table.tripId, table.settlementId, table.previewId],
      foreignColumns: [settlements.tripId, settlements.id, settlements.previewId],
    }),
    foreignKey({
      columns: [table.tripId, table.previewId, table.paymentId, table.kind],
      foreignColumns: [
        previewItems.tripId,
        previewItems.previewId,
        previewItems.paymentId,
        previewItems.kind,
      ],
    }),
    foreignKey({
      columns: [table.tripId, table.paymentId],
      foreignColumns: [payments.tripId, payments.id],
    }),
    foreignKey({
      name: "items_reversal_base_fk",
      columns: [table.tripId, table.baseSettlementId, table.paymentId, table.baseKind],
      foreignColumns: [table.tripId, table.settlementId, table.paymentId, table.kind],
    }),
    index("settlement_items_payment_idx").on(table.tripId, table.paymentId, table.settlementId),
  ],
);

export const settlementCancellations = settlement.table(
  "cancellations",
  {
    settlementId: uuid("settlement_id").primaryKey(),
    tripId: uuid("trip_id").notNull(),
    cancelledBy: uuid("cancelled_by").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    foreignKey({
      columns: [table.tripId, table.settlementId],
      foreignColumns: [settlements.tripId, settlements.id],
    }),
    foreignKey({
      columns: [table.tripId, table.cancelledBy],
      foreignColumns: [tripParticipants.tripId, tripParticipants.userId],
    }),
    index("settlement_cancellations_trip_idx").on(table.tripId),
  ],
);

export const activeClaims = settlement.table(
  "active_claims",
  {
    tripId: uuid("trip_id").notNull(),
    paymentId: uuid("payment_id").notNull(),
    kind: text("kind").notNull(),
    settlementId: uuid("settlement_id").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.paymentId, table.kind] }),
    check("active_claims_kind_check", sql`${table.kind} IN ('BASE', 'REVERSAL')`),
    foreignKey({
      columns: [table.tripId, table.settlementId, table.paymentId, table.kind],
      foreignColumns: [
        settlementItems.tripId,
        settlementItems.settlementId,
        settlementItems.paymentId,
        settlementItems.kind,
      ],
    }),
    index("active_claims_settlement_idx").on(table.tripId, table.settlementId),
  ],
);
