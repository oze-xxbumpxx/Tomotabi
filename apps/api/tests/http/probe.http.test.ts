import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { configureApp } from "../../src/bootstrap/configure-app";
import { UserId } from "../../src/common/domain/user-id";
import { IDENTITY_READER } from "../../src/modules/identity/adapter/outbound/identity-reader";
import {
  SESSION_VERIFIER,
  type SessionVerificationResult,
  type SessionVerifier,
} from "../../src/modules/identity/adapter/outbound/session-verifier";

const ORIGIN = "http://localhost:3000";
const USER_ID = UserId.parse("550e8400-e29b-41d4-a716-446655440000");
const EXPIRES_AT = new Date("2027-01-01T00:00:00.000Z");

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
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app, null);
  await app.init();
  return app;
}

describe("foundation HTTP with guards", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApp(
      verifierReturning({
        kind: "authenticated",
        userId: USER_ID,
        expiresAt: EXPIRES_AT,
      }),
    );
  });

  afterAll(async () => {
    await app.close();
    delete process.env.PUBLIC_APP_ORIGIN;
  });

  it("returns process health without authentication (A-15)", async () => {
    const response = await request(app.getHttpServer()).get("/api/health");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
  });

  it("reads probes while authenticated", async () => {
    const response = await request(app.getHttpServer()).get(
      "/api/foundation/probes",
    );
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ count: expect.any(Number) });
  });

  it("rejects POST without a matching Origin (OriginGuard is global)", async () => {
    const response = await request(app.getHttpServer())
      .post("/api/foundation/probes/increment")
      .set("content-type", "application/json")
      .send({});
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ code: "FORBIDDEN_ORIGIN" });
  });

  it("rejects POST with a non-JSON Content-Type", async () => {
    const response = await request(app.getHttpServer())
      .post("/api/foundation/probes/increment")
      .set("origin", ORIGIN)
      .set("content-type", "text/plain")
      .send("x");
    expect(response.status).toBe(415);
    expect(response.body).toMatchObject({ code: "UNSUPPORTED_MEDIA_TYPE" });
  });

  it("increments the probe count with matching Origin and JSON Content-Type", async () => {
    const before = await request(app.getHttpServer()).get(
      "/api/foundation/probes",
    );
    const created = await request(app.getHttpServer())
      .post("/api/foundation/probes/increment")
      .set("origin", ORIGIN)
      .set("content-type", "application/json")
      .send({});
    expect(created.status).toBe(200);
    expect(created.body).toEqual({ count: before.body.count + 1 });
  });

  it("returns /api/me for the authenticated user", async () => {
    const response = await request(app.getHttpServer()).get("/api/me");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      user: { id: USER_ID, displayName: "ひなた" },
      sessionExpiresAt: EXPIRES_AT.toISOString(),
    });
    expect(response.headers["cache-control"]).toBe("private, no-store");
  });
});

describe("foundation HTTP without authentication", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApp(verifierReturning({ kind: "unauthenticated" }));
  });

  afterAll(async () => {
    await app.close();
    delete process.env.PUBLIC_APP_ORIGIN;
  });

  it.each(["/api/foundation/probes", "/api/me"])(
    "rejects GET %s with 401 UNAUTHENTICATED",
    async (path) => {
      const response = await request(app.getHttpServer()).get(path);
      expect(response.status).toBe(401);
      expect(response.body).toMatchObject({ code: "UNAUTHENTICATED" });
    },
  );

  it("keeps /api/health public", async () => {
    const response = await request(app.getHttpServer()).get("/api/health");
    expect(response.status).toBe(200);
  });
});
