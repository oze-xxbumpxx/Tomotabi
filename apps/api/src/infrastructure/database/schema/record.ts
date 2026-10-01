import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  pgSchema,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { plans, tripParticipants, trips } from "./planning";

// Reference spec: docs/旅行アプリ設計 3/詳細設計/sql/03_planning_records.sql and 01_finance.sql
// plan_events, plan_event_cancellations, payments and payment_cancellations are append-only;
// the BEFORE UPDATE OR DELETE triggers live in custom migrations
// (see drizzle/0003_history_triggers.sql and 0006_finance_triggers.sql).
export const record = pgSchema("record");

const withTimezone = { withTimezone: true } as const;

const createdAt = () => timestamp("created_at", withTimezone).defaultNow().notNull();

export const planEvents = record.table(
  "plan_events",
  {
    id: uuid("id").default(sql`pg_catalog.gen_random_uuid()`).primaryKey(),
    tripId: uuid("trip_id").notNull(),
    planId: uuid("plan_id").notNull(),
    eventKind: text("event_kind").notNull(),
    createdBy: uuid("created_by").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    unique("plan_events_trip_id_plan_id_event_kind_id_unique").on(
      table.tripId,
      table.planId,
      table.eventKind,
      table.id,
    ),
    unique("plan_events_trip_id_id_unique").on(table.tripId, table.id),
    check("plan_events_event_kind_check", sql`${table.eventKind} IN ('achievement', 'booking')`),
    foreignKey({
      columns: [table.tripId, table.planId],
      foreignColumns: [plans.tripId, plans.id],
    }),
    foreignKey({
      columns: [table.tripId, table.createdBy],
      foreignColumns: [tripParticipants.tripId, tripParticipants.userId],
    }),
    index("plan_events_history_idx").on(table.tripId, table.planId),
    index("plan_events_timeline_idx").on(table.tripId, table.createdAt.desc(), table.id.desc()),
  ],
);

export const planEventCancellations = record.table(
  "plan_event_cancellations",
  {
    eventId: uuid("event_id").primaryKey(),
    tripId: uuid("trip_id").notNull(),
    cancelledBy: uuid("cancelled_by").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    foreignKey({
      columns: [table.tripId, table.eventId],
      foreignColumns: [planEvents.tripId, planEvents.id],
    }),
    foreignKey({
      columns: [table.tripId, table.cancelledBy],
      foreignColumns: [tripParticipants.tripId, tripParticipants.userId],
    }),
    index("plan_event_cancellations_timeline_idx").on(
      table.tripId,
      table.createdAt.desc(),
      table.eventId.desc(),
    ),
  ],
);

export const activePlanEvents = record.table(
  "active_plan_events",
  {
    tripId: uuid("trip_id").notNull(),
    planId: uuid("plan_id").notNull(),
    eventKind: text("event_kind").notNull(),
    eventId: uuid("event_id").notNull().unique(),
  },
  (table) => [
    primaryKey({ columns: [table.planId, table.eventKind] }),
    check("active_plan_events_event_kind_check", sql`${table.eventKind} IN ('achievement', 'booking')`),
    foreignKey({
      columns: [table.tripId, table.planId, table.eventKind, table.eventId],
      foreignColumns: [planEvents.tripId, planEvents.planId, planEvents.eventKind, planEvents.id],
    }),
  ],
);

// amount_yen is capped at 9,999,999 by design (the reference spec allows 999,999,999).
export const payments = record.table(
  "payments",
  {
    id: uuid("id").default(sql`pg_catalog.gen_random_uuid()`).primaryKey(),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id),
    planId: uuid("plan_id"),
    amountYen: bigint("amount_yen", { mode: "bigint" }).notNull(),
    payerSlot: smallint("payer_slot").notNull(),
    slot0Percent: smallint("slot0_percent").notNull(),
    slot0BurdenYen: bigint("slot0_burden_yen", { mode: "bigint" }).notNull(),
    slot1BurdenYen: bigint("slot1_burden_yen", { mode: "bigint" }).notNull(),
    contributionYen: bigint("contribution_yen", { mode: "bigint" }).notNull(),
    label: varchar("label", { length: 100 }),
    createdBy: uuid("created_by").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    unique("payments_trip_id_id_unique").on(table.tripId, table.id),
    check("payments_amount_yen_check", sql`${table.amountYen} BETWEEN 1 AND 9999999`),
    check("payments_payer_slot_check", sql`${table.payerSlot} IN (0, 1)`),
    check("payments_slot0_percent_check", sql`${table.slot0Percent} BETWEEN 0 AND 100`),
    check("payments_slot0_burden_yen_check", sql`${table.slot0BurdenYen} >= 0`),
    check("payments_slot1_burden_yen_check", sql`${table.slot1BurdenYen} >= 0`),
    check(
      "payments_label_check",
      sql`${table.label} IS NULL OR char_length(btrim(${table.label})) BETWEEN 1 AND 100`,
    ),
    check("payments_burden_sum", sql`${table.slot0BurdenYen} + ${table.slot1BurdenYen} = ${table.amountYen}`),
    check(
      "payments_contribution",
      sql`(${table.payerSlot} = 0 AND ${table.slot1BurdenYen} = ${table.amountYen} * (100 - ${table.slot0Percent}) / 100 AND ${table.contributionYen} = ${table.slot1BurdenYen})
          OR (${table.payerSlot} = 1 AND ${table.slot0BurdenYen} = ${table.amountYen} * ${table.slot0Percent} / 100 AND ${table.contributionYen} = -${table.slot0BurdenYen})`,
    ),
    foreignKey({
      columns: [table.tripId, table.planId],
      foreignColumns: [plans.tripId, plans.id],
    }),
    foreignKey({
      columns: [table.tripId, table.payerSlot],
      foreignColumns: [tripParticipants.tripId, tripParticipants.slot],
    }),
    foreignKey({
      columns: [table.tripId, table.createdBy],
      foreignColumns: [tripParticipants.tripId, tripParticipants.userId],
    }),
    index("payments_trip_created_idx").on(table.tripId, table.createdAt.desc(), table.id.desc()),
    index("payments_plan_idx")
      .on(table.tripId, table.planId)
      .where(sql`${table.planId} IS NOT NULL`),
  ],
);

export const paymentCancellations = record.table(
  "payment_cancellations",
  {
    paymentId: uuid("payment_id").primaryKey(),
    tripId: uuid("trip_id").notNull(),
    cancelledBy: uuid("cancelled_by").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    foreignKey({
      columns: [table.tripId, table.paymentId],
      foreignColumns: [payments.tripId, payments.id],
    }),
    foreignKey({
      columns: [table.tripId, table.cancelledBy],
      foreignColumns: [tripParticipants.tripId, tripParticipants.userId],
    }),
    index("payment_cancellations_trip_idx").on(table.tripId),
  ],
);
