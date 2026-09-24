import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  pgSchema,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

// Columns follow `npx auth generate` for better-auth 1.7.x, moved into the identity schema.
// Timestamps are timestamptz and accounts gains UNIQUE(provider_id, account_id) (not generated).
export const identity = pgSchema("identity");

const withTimezone = { withTimezone: true } as const;

const id = () => uuid("id").default(sql`pg_catalog.gen_random_uuid()`).primaryKey();
const createdAt = () => timestamp("created_at", withTimezone).defaultNow().notNull();
const updatedAt = () =>
  timestamp("updated_at", withTimezone)
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull();

export const users = identity.table("users", {
  id: id(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const sessions = identity.table(
  "sessions",
  {
    id: id(),
    expiresAt: timestamp("expires_at", withTimezone).notNull(),
    token: text("token").notNull().unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [index("sessions_user_id_idx").on(table.userId)],
);

export const accounts = identity.table(
  "accounts",
  {
    id: id(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", withTimezone),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", withTimezone),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("accounts_user_id_idx").on(table.userId),
    unique("accounts_provider_account_unique").on(table.providerId, table.accountId),
  ],
);

export const verifications = identity.table(
  "verifications",
  {
    id: id(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", withTimezone).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("verifications_identifier_idx").on(table.identifier)],
);

// Reference spec: docs/旅行アプリ設計 3/詳細設計/sql/02_auth_allowlist.sql
export const allowedGoogleAccounts = identity.table(
  "allowed_google_accounts",
  {
    slot: smallint("slot").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .unique()
      .references(() => users.id),
    googleSub: text("google_sub").notNull().unique(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: createdAt(),
  },
  (table) => [
    check("allowed_google_accounts_slot_check", sql`${table.slot} IN (0, 1)`),
    check(
      "allowed_google_accounts_google_sub_length_check",
      sql`char_length(${table.googleSub}) BETWEEN 1 AND 255`,
    ),
  ],
);
