import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  pgSchema,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  unique,
  uuid,
  varchar,
  type PgTableExtraConfigValue,
} from "drizzle-orm/pg-core";
import { users } from "./identity";

// Reference spec: docs/旅行アプリ設計3/詳細設計/sql/03_planning_records.sql and 04_trip_lifecycle.sql
export const planning = pgSchema("planning");

const withTimezone = { withTimezone: true } as const;

const id = () => uuid("id").default(sql`pg_catalog.gen_random_uuid()`).primaryKey();
const createdAt = () => timestamp("created_at", withTimezone).defaultNow().notNull();
const updatedAt = () =>
  timestamp("updated_at", withTimezone)
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull();
const version = () => bigint("version", { mode: "number" }).default(1).notNull();

// trips and trip_participants reference each other (started_by / finished_by must be
// participants of the same trip), so the starter / finisher FKs are composite FKs here
// and every FK is applied with ALTER TABLE after both tables exist. The explicit return
// type on this table's extra config keeps TypeScript out of the circular inference.
export const trips = planning.table(
  "trips",
  {
    id: id(),
    name: varchar("name", { length: 100 }).notNull(),
    startsOn: date("starts_on", { mode: "string" }).notNull(),
    endsOn: date("ends_on", { mode: "string" }).notNull(),
    status: text("status").default("planning").notNull(),
    version: version(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    startedAt: timestamp("started_at", withTimezone),
    startedBy: uuid("started_by"),
    finishedAt: timestamp("finished_at", withTimezone),
    finishedBy: uuid("finished_by"),
  },
  (table): PgTableExtraConfigValue[] => [
    check("trips_status_check", sql`${table.status} IN ('planning', 'traveling', 'finished')`),
    check("trips_version_check", sql`${table.version} > 0`),
    check("trip_name_nonempty", sql`char_length(btrim(${table.name})) > 0`),
    check("trip_period_valid", sql`${table.startsOn} <= ${table.endsOn}`),
    check(
      "trip_lifecycle_fields",
      sql`(${table.status} = 'planning' AND ${table.startedAt} IS NULL AND ${table.startedBy} IS NULL AND ${table.finishedAt} IS NULL AND ${table.finishedBy} IS NULL)
          OR (${table.status} = 'traveling' AND ${table.startedAt} IS NOT NULL AND ${table.startedBy} IS NOT NULL AND ${table.finishedAt} IS NULL AND ${table.finishedBy} IS NULL)
          OR (${table.status} = 'finished' AND ${table.startedAt} IS NOT NULL AND ${table.startedBy} IS NOT NULL AND ${table.finishedAt} IS NOT NULL AND ${table.finishedBy} IS NOT NULL AND ${table.finishedAt} >= ${table.startedAt})`,
    ),
    foreignKey({
      name: "trip_starter_member",
      columns: [table.id, table.startedBy],
      foreignColumns: [tripParticipants.tripId, tripParticipants.userId],
    }),
    foreignKey({
      name: "trip_finisher_member",
      columns: [table.id, table.finishedBy],
      foreignColumns: [tripParticipants.tripId, tripParticipants.userId],
    }),
    index("trips_list_idx").on(table.createdAt.desc(), table.id.desc()),
  ],
);

export const tripParticipants = planning.table(
  "trip_participants",
  {
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id),
    slot: smallint("slot").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
  },
  (table) => [
    primaryKey({ columns: [table.tripId, table.slot] }),
    unique("trip_participants_trip_id_user_id_unique").on(table.tripId, table.userId),
    check("trip_participants_slot_check", sql`${table.slot} IN (0, 1)`),
    index("trip_participants_user_idx").on(table.userId, table.tripId),
  ],
);

export const plans = planning.table(
  "plans",
  {
    id: id(),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id),
    name: varchar("name", { length: 100 }).notNull(),
    kind: text("kind").notNull(),
    plannedDate: date("planned_date", { mode: "string" }).notNull(),
    plannedTime: time("planned_time", { precision: 0 }),
    memo: varchar("memo", { length: 2000 }),
    cancelledAt: timestamp("cancelled_at", withTimezone),
    cancelledBy: uuid("cancelled_by"),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("plans_trip_id_id_unique").on(table.tripId, table.id),
    check(
      "plans_kind_check",
      sql`${table.kind} IN ('place', 'food', 'shopping', 'lodging', 'transport')`,
    ),
    check("plans_version_check", sql`${table.version} > 0`),
    check("plan_name_nonempty", sql`char_length(btrim(${table.name})) > 0`),
    check(
      "plan_time_minute",
      sql`${table.plannedTime} IS NULL OR (${table.plannedTime} < TIME '24:00' AND EXTRACT(SECOND FROM ${table.plannedTime}) = 0)`,
    ),
    check("plan_cancellation_pair", sql`(${table.cancelledAt} IS NULL) = (${table.cancelledBy} IS NULL)`),
    foreignKey({
      name: "plan_canceller_member",
      columns: [table.tripId, table.cancelledBy],
      foreignColumns: [tripParticipants.tripId, tripParticipants.userId],
    }),
    index("plans_day_idx").on(
      table.tripId,
      table.plannedDate,
      table.plannedTime,
      table.createdAt,
      table.id,
    ),
  ],
);
