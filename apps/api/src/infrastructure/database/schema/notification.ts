import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  index,
  pgSchema,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./identity";

// Reference spec: docs/旅行アプリ設計3/詳細設計/sql/05_push_notifications.sql
// registration_session_id はセッションを消しても購読の行を連鎖で消さないため、
// Better Authのセッションの表を参照しない（設計書「DB 設計」）。
export const notification = pgSchema("notification");

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

const withTimezone = { withTimezone: true } as const;

export const pushSubscriptions = notification.table(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    endpoint: text("endpoint").notNull(),
    endpointHash: bytea("endpoint_hash").notNull().unique(),
    p256dh: bytea("p256dh").notNull(),
    authSecret: bytea("auth_secret").notNull(),
    expirationTime: timestamp("expiration_time", withTimezone),
    registrationSessionId: text("registration_session_id").notNull(),
    deviceLabel: text("device_label").notNull(),
    vapidKeyId: text("vapid_key_id").notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    revision: bigint("revision", { mode: "bigint" }).default(sql`1`).notNull(),
    createdAt: timestamp("created_at", withTimezone).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", withTimezone).defaultNow().notNull(),
  },
  (table) => [
    check(
      "push_subscriptions_endpoint_check",
      sql`length(${table.endpoint}) BETWEEN 1 AND 4096`,
    ),
    check(
      "push_subscriptions_endpoint_hash_check",
      sql`octet_length(${table.endpointHash}) = 32`,
    ),
    check(
      "push_subscriptions_p256dh_check",
      sql`octet_length(${table.p256dh}) = 65 AND get_byte(${table.p256dh}, 0) = 4`,
    ),
    check(
      "push_subscriptions_auth_secret_check",
      sql`octet_length(${table.authSecret}) = 16`,
    ),
    check(
      "push_subscriptions_registration_session_id_check",
      sql`length(${table.registrationSessionId}) > 0`,
    ),
    check(
      "push_subscriptions_device_label_check",
      sql`length(${table.deviceLabel}) BETWEEN 1 AND 60`,
    ),
    check(
      "push_subscriptions_vapid_key_id_check",
      sql`length(${table.vapidKeyId}) BETWEEN 1 AND 64`,
    ),
    check("push_subscriptions_revision_check", sql`${table.revision} > 0`),
    check(
      "push_subscriptions_updated_at_check",
      sql`${table.updatedAt} >= ${table.createdAt}`,
    ),
    index("push_subscriptions_user").on(table.userId),
    index("push_subscriptions_session")
      .on(table.userId, table.registrationSessionId)
      .where(sql`${table.enabled}`),
  ],
);

// 通知再送キューではない。ログアウト後の遅延登録を防ぐセッション単位の停止記録。
export const closedPushSessions = notification.table(
  "closed_push_sessions",
  {
    sessionId: text("session_id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    closedAt: timestamp("closed_at", withTimezone).defaultNow().notNull(),
  },
  (table) => [
    check(
      "closed_push_sessions_session_id_check",
      sql`length(${table.sessionId}) > 0`,
    ),
  ],
);
