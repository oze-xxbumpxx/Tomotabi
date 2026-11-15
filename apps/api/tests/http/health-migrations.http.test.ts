import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { UserId } from "../../src/common/domain/user-id";
import { IDENTITY_READER } from "../../src/modules/identity/adapter/outbound/identity-reader";
import {
  SESSION_VERIFIER,
  type SessionVerificationResult,
} from "../../src/modules/identity/adapter/outbound/session-verifier";
import { createHttpTestApp } from "../support/nest-app";

const ORIGIN = "http://localhost:3000";

async function createApp(
  result: SessionVerificationResult,
): Promise<INestApplication> {
  process.env.PUBLIC_APP_ORIGIN = ORIGIN;
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(SESSION_VERIFIER)
    .useValue({ verify: async () => result })
    .overrideProvider(IDENTITY_READER)
    .useValue({ findDisplayName: async () => "ひなた" })
    .compile();
  return createHttpTestApp(moduleRef, null);
}

// DATABASE_URLが無いので、メモリの実装（いつもnull）が選ばれる。
describe("最後に流したmigrationの時刻の口（DBなし）", () => {
  const apps: INestApplication[] = [];

  beforeAll(async () => {
    apps.push(await createApp({ kind: "unauthenticated" }));
    apps.push(
      await createApp({
        kind: "authenticated",
        userId: UserId.parse("550e8400-e29b-41d4-a716-446655440000"),
        sessionId: "test-session-id",
        expiresAt: new Date("2027-01-01T00:00:00.000Z"),
      }),
    );
  });

  afterAll(async () => {
    await Promise.all(apps.map((app) => app.close()));
    delete process.env.PUBLIC_APP_ORIGIN;
  });

  it("MD-01: ログインなしで読め、時刻1つだけを返す", async () => {
    const response = await request(apps[0]!.getHttpServer()).get(
      "/api/health/migrations",
    );
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ lastAppliedAt: null });
  });

  it("MD-02: ログインしていても同じものを返す", async () => {
    const response = await request(apps[1]!.getHttpServer()).get(
      "/api/health/migrations",
    );
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ lastAppliedAt: null });
  });

  it("MD-03: /api/healthは今までどおり", async () => {
    const response = await request(apps[0]!.getHttpServer()).get("/api/health");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
  });
});
