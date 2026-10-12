import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { UserId } from "../../src/common/domain/user-id";
import { closePool } from "../../src/infrastructure/database/pool";
import { IDENTITY_READER } from "../../src/modules/identity/adapter/outbound/identity-reader";
import {
  SESSION_VERIFIER,
  type SessionVerifier,
} from "../../src/modules/identity/adapter/outbound/session-verifier";
import { startPostgres, type TestDatabase } from "../support/database";
import { createHttpTestApp } from "../support/nest-app";

const ORIGIN = "http://localhost:3000";
const USER_ID = UserId.parse("550e8400-e29b-41d4-a716-446655440000");

function dbDur(response: request.Response): number {
  const header = response.headers["server-timing"];
  const match = /db;dur=(\d+(?:\.\d+)?)/.exec(String(header));
  if (match === null) {
    throw new Error(`Server-Timingにdbが無い: ${String(header)}`);
  }
  return Number(match[1]);
}

// ID-01: DBに問い合わせる要求ではdb;durが0より大きく、問い合わせない要求では0
describe("実DBでのdbの時間（ID-01）", () => {
  let db: TestDatabase | undefined;
  let app: INestApplication | undefined;

  beforeAll(async () => {
    db = await startPostgres();
    db.admin.on("error", () => {});
    const sql = readFileSync(
      join(__dirname, "../../src/infrastructure/database/sql/m0_probe.sql"),
      "utf8",
    );
    await db.admin.query(sql);

    // infra.m0_probesにはapp_runtimeへの権限が無いので、コンテナの既定の接続を使う。
    process.env.DATABASE_URL = db.container.getConnectionUri();
    process.env.PUBLIC_APP_ORIGIN = ORIGIN;

    const verifier: SessionVerifier = {
      verify: async () => ({
        kind: "authenticated",
        userId: USER_ID,
        sessionId: "test-session-id",
        expiresAt: new Date("2027-01-01T00:00:00.000Z"),
      }),
    };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SESSION_VERIFIER)
      .useValue(verifier)
      .overrideProvider(IDENTITY_READER)
      .useValue({ findDisplayName: async () => "ひなた" })
      .compile();
    app = await createHttpTestApp(moduleRef, null);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await closePool();
    await db?.stop();
    delete process.env.DATABASE_URL;
    delete process.env.PUBLIC_APP_ORIGIN;
  });

  it("DBに問い合わせる要求はdb;durが0より大きく、/api/healthは0", async () => {
    if (!app) {
      throw new Error("app was not created");
    }
    const health = await request(app.getHttpServer()).get("/api/health");
    expect(health.status).toBe(200);
    expect(dbDur(health)).toBe(0);

    const probes = await request(app.getHttpServer()).get(
      "/api/foundation/probes",
    );
    expect(probes.status).toBe(200);
    expect(dbDur(probes)).toBeGreaterThan(0);
  });
});
