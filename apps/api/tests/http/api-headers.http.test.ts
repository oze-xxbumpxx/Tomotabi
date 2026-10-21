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
  type SessionVerifier,
} from "../../src/modules/identity/adapter/outbound/session-verifier";
import { createHttpTestApp } from "../support/nest-app";

const ORIGIN = "http://localhost:3000";
const USER_ID = UserId.parse("550e8400-e29b-41d4-a716-446655440000");
const EXPIRES_AT = new Date("2027-01-01T00:00:00.000Z");

const TIMING_PATTERN =
  /^app;dur=\d+(\.\d+)?, db;dur=\d+(\.\d+)?, cold;desc="(true|false)"(, boot;dur=\d+(\.\d+)?)?$/;

// IH-01〜IH-03: 全部の/apiの応答に付くヘッダー
function expectApiHeaders(response: request.Response): void {
  expect(response.headers["cache-control"]).toBe("private, no-store");
  expect(response.headers["cdn-cache-control"]).toBe("no-store");
  expect(response.headers["vercel-cdn-cache-control"]).toBe("no-store");
  expect(response.headers["server-timing"]).toMatch(TIMING_PATTERN);
}

function verifierReturning(result: SessionVerificationResult): SessionVerifier {
  return { verify: async () => result };
}

async function createApp(verifier: SessionVerifier): Promise<INestApplication> {
  process.env.PUBLIC_APP_ORIGIN = ORIGIN;
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(SESSION_VERIFIER)
    .useValue(verifier)
    .overrideProvider(IDENTITY_READER)
    .useValue({ findDisplayName: async () => "ひなた" })
    .compile();
  return createHttpTestApp(moduleRef, null);
}

describe("全部の/apiの応答のヘッダー（IH-01〜IH-03）", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApp(
      verifierReturning({
        kind: "authenticated",
        userId: USER_ID,
        sessionId: "test-session-id",
        expiresAt: EXPIRES_AT,
      }),
    );
  });

  afterAll(async () => {
    await app.close();
    delete process.env.PUBLIC_APP_ORIGIN;
  });

  it("業務のAPIの応答にキャッシュを止める3つとServer-Timingが付く", async () => {
    for (const response of [
      await request(app.getHttpServer()).get("/api/health"),
      await request(app.getHttpServer()).get("/api/foundation/probes"),
      await request(app.getHttpServer()).get("/api/me"),
    ]) {
      expect(response.status).toBe(200);
      expectApiHeaders(response);
    }
  });

  it("Expressが本文から作る弱いETagを付けない（#246）", async () => {
    const response = await request(app.getHttpServer()).get("/api/me");
    expect(response.status).toBe(200);
    expect(response.headers.etag).toBeUndefined();
  });

  it("認証の経路にも同じ3つが付く（公開経路の503・経路の制限の404）", async () => {
    // authなしのため公開経路は503、許可リスト外は404（どちらも経路の制限側の応答）。
    const unavailable = await request(app.getHttpServer())
      .post("/api/auth/sign-in/social")
      .set("origin", ORIGIN)
      .set("content-type", "application/json")
      .send({});
    expect(unavailable.status).toBe(503);
    expectApiHeaders(unavailable);

    const notFound = await request(app.getHttpServer()).get(
      "/api/auth/get-session",
    );
    expect(notFound.status).toBe(404);
    expectApiHeaders(notFound);
  });

  it("経路の制限の403・404・503とエラーの応答にも同じ3つが付く", async () => {
    const forbidden = await request(app.getHttpServer())
      .post("/api/foundation/probes/increment")
      .set("content-type", "application/json")
      .send({});
    expect(forbidden.status).toBe(403);
    expectApiHeaders(forbidden);

    const notFound = await request(app.getHttpServer()).get(
      "/api/no-such-route",
    );
    expect(notFound.status).toBe(404);
    expectApiHeaders(notFound);

    const badJson = await request(app.getHttpServer())
      .post("/api/foundation/probes/increment")
      .set("origin", ORIGIN)
      .set("content-type", "application/json")
      .send("{");
    expect(badJson.status).toBe(400);
    expectApiHeaders(badJson);
  });
});

describe("認証が無いときの応答（IH-02・IH-03）", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApp(verifierReturning({ kind: "unauthenticated" }));
  });

  afterAll(async () => {
    await app.close();
    delete process.env.PUBLIC_APP_ORIGIN;
  });

  it("401の応答にも同じ3つが付く", async () => {
    const response = await request(app.getHttpServer()).get("/api/me");
    expect(response.status).toBe(401);
    expectApiHeaders(response);
  });
});
