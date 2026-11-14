import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { closePool } from "../../src/infrastructure/database/pool";
import { PgMigrationStatus } from "../../src/modules/foundation/infrastructure/pg-migration-status";
import { IDENTITY_READER } from "../../src/modules/identity/adapter/outbound/identity-reader";
import { SESSION_VERIFIER } from "../../src/modules/identity/adapter/outbound/session-verifier";
import {
  createRoles,
  MIGRATIONS_FOLDER,
  migrateAsMigrator,
  startPostgres,
  type TestDatabase,
} from "../support/database";
import { createHttpTestApp } from "../support/nest-app";

const ORIGIN = "http://localhost:3000";

type Journal = { entries: { when: number }[] };

function lastWhenInJournal(): number {
  const journal = JSON.parse(
    readFileSync(join(MIGRATIONS_FOLDER, "meta/_journal.json"), "utf8"),
  ) as Journal;
  return Math.max(...journal.entries.map((entry) => entry.when));
}

async function createApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(SESSION_VERIFIER)
    .useValue({ verify: async () => ({ kind: "unauthenticated" }) })
    .overrideProvider(IDENTITY_READER)
    .useValue({ findDisplayName: async () => "ひなた" })
    .compile();
  return createHttpTestApp(moduleRef, null);
}

describe("最後に流したmigrationの時刻（実DB）", () => {
  let db: TestDatabase | undefined;
  let runtime: Pool | undefined;

  beforeAll(async () => {
    db = await startPostgres();
    await createRoles(db);
    await migrateAsMigrator(db);
    runtime = db.poolFor("app_runtime");
  });

  afterAll(async () => {
    await closePool();
    delete process.env.DATABASE_URL;
    delete process.env.PUBLIC_APP_ORIGIN;
    await db?.stop();
  });

  it("MD-04: 実行用のロールで読め、_journal.jsonの最後のwhenと一致する", async () => {
    const last = await new PgMigrationStatus(runtime!).lastAppliedAt();
    expect(typeof last).toBe("number");
    expect(last).toBe(lastWhenInJournal());
  });

  it("MD-06: 実行用のロールは履歴の表に書けない", async () => {
    await expect(
      runtime!.query(
        `INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at") VALUES ('x', 1)`,
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      runtime!.query(`DELETE FROM "drizzle"."__drizzle_migrations"`),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("MD-07: HTTPではログインなしで、時刻1つだけを返す", async () => {
    process.env.DATABASE_URL = db!.urlFor("app_runtime");
    process.env.PUBLIC_APP_ORIGIN = ORIGIN;
    const app = await createApp();
    try {
      const response = await request(app.getHttpServer()).get(
        "/api/health/migrations",
      );
      expect(response.status).toBe(200);
      expect(Object.keys(response.body as object)).toEqual(["lastAppliedAt"]);
      expect(response.body).toEqual({ lastAppliedAt: lastWhenInJournal() });
    } finally {
      await app.close();
      await closePool();
    }
  });

  it("MD-08: 読む権限が無いと500で、表の名前やSQLを出さない", async () => {
    await db!.admin.query(
      `REVOKE SELECT ON "drizzle"."__drizzle_migrations" FROM app_runtime`,
    );
    process.env.DATABASE_URL = db!.urlFor("app_runtime");
    process.env.PUBLIC_APP_ORIGIN = ORIGIN;
    const app = await createApp();
    try {
      const response = await request(app.getHttpServer()).get(
        "/api/health/migrations",
      );
      expect(response.status).toBe(500);
      expect(response.text).not.toMatch(
        /__drizzle_migrations|SELECT|permission/i,
      );
    } finally {
      await app.close();
      await closePool();
      await db!.admin.query(
        `GRANT SELECT ON "drizzle"."__drizzle_migrations" TO app_runtime`,
      );
    }
  });
});

describe("1本も流していないDB（実DB）", () => {
  let db: TestDatabase | undefined;

  beforeAll(async () => {
    db = await startPostgres();
    await createRoles(db);
    // drizzleのmigrateが最初に作るものと同じ形の、空の履歴の表を作る。
    await db.admin.query(`CREATE SCHEMA "drizzle"`);
    await db.admin.query(
      `CREATE TABLE "drizzle"."__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`,
    );
    await db.admin.query(
      readFileSync(
        join(MIGRATIONS_FOLDER, "0015_app_runtime_read_migrations.sql"),
        "utf8",
      ),
    );
  });

  afterAll(async () => {
    await db?.stop();
  });

  it("MD-05: nullを返す", async () => {
    const reader = new PgMigrationStatus(db!.poolFor("app_runtime"));
    await expect(reader.lastAppliedAt()).resolves.toBeNull();
  });
});
