import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { plans, tripParticipants } from "./planning";

// Reference spec: docs/旅行アプリ設計 3/詳細設計/sql/03_planning_records.sql
// plan_events and plan_event_cancellations are append-only; the BEFORE UPDATE OR DELETE
// triggers live in a custom migration (see drizzle/0003_history_triggers.sql).
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
