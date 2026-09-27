import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  jsonb,
  pgSchema,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { users } from "./identity";
import { trips, tripParticipants } from "./planning";

// Reference spec: docs/旅行アプリ設計 3/詳細設計/sql/01_finance.sql and 03_planning_records.sql
export const infra = pgSchema("infra");

const withTimezone = { withTimezone: true } as const;

export const tripFinanceGuards = infra.table(
  "trip_finance_guards",
  {
    tripId: uuid("trip_id")
      .primaryKey()
      .references(() => trips.id),
    nextSettlementSequence: bigint("next_settlement_sequence", { mode: "number" })
      .default(1)
      .notNull(),
  },
  (table) => [
    check(
      "trip_finance_guards_next_settlement_sequence_check",
      sql`${table.nextSettlementSequence} > 0`,
    ),
  ],
);

// resource_type already includes the M3-M4 kinds so the CHECK never has to be replaced.
export const commandReceipts = infra.table(
  "command_receipts",
  {
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id),
    operation: varchar("operation", { length: 100 }).notNull(),
    idempotencyKey: uuid("idempotency_key").notNull(),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id),
    requestHash: varchar("request_hash", { length: 64 }).notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: uuid("resource_id").notNull(),
    httpStatus: smallint("http_status").notNull(),
    responseBody: jsonb("response_body"),
    createdAt: timestamp("created_at", withTimezone).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.actorId, table.operation, table.idempotencyKey] }),
    check("command_receipts_request_hash_check", sql`${table.requestHash} ~ '^[0-9a-f]{64}$'`),
    check(
      "command_receipts_resource_type_check",
      sql`${table.resourceType} IN ('payment', 'payment_cancellation', 'preview', 'settlement', 'settlement_cancellation', 'plan', 'trip', 'plan_event', 'plan_event_cancellation')`,
    ),
    check("command_receipts_http_status_check", sql`${table.httpStatus} IN (200, 201)`),
    check(
      "mutable_resource_receipt_snapshot",
      sql`${table.resourceType} NOT IN ('plan', 'trip') OR ${table.responseBody} IS NOT NULL`,
    ),
    foreignKey({
      columns: [table.tripId, table.actorId],
      foreignColumns: [tripParticipants.tripId, tripParticipants.userId],
    }),
  ],
);
