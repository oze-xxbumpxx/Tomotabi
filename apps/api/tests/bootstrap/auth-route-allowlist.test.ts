import express, { type Express } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { authRouteAllowlist } from "../../src/bootstrap/auth-route-allowlist";

const PUBLIC_ORIGIN = "http://localhost:3000";
const EVIL_ORIGIN = "http://evil.example.test";
const HANDLER_STATUS = 299;

function createApp(authAvailable = true): Express {
  const app = express();
  app.use("/api/auth", authRouteAllowlist(PUBLIC_ORIGIN, authAvailable));
  app.all("/api/auth/*splat", (_req, res) => {
    res.status(HANDLER_STATUS).json({ reached: true });
  });
  return app;
}

describe("authRouteAllowlist", () => {
  // U-11: 公開 3 経路は次の handler（Better Auth 本体）へ渡す
  it.each([
    ["post", "/api/auth/sign-in/social", { origin: PUBLIC_ORIGIN }],
    ["get", "/api/auth/callback/google", {}],
    ["post", "/api/auth/sign-out", { origin: PUBLIC_ORIGIN }],
  ] as const)("passes %s %s (U-11)", async (method, path, headers) => {
    const agent = request(createApp());
    const response = await agent[method](path).set(headers);

    expect(response.status).toBe(HANDLER_STATUS);
  });

  // U-12: 公開以外の /api/auth/* は 404
  it.each([
    "/api/auth/get-session",
    "/api/auth/list-sessions",
    "/api/auth/list-accounts",
    "/api/auth/sign-up/email",
    "/api/auth/link-social",
    "/api/auth/delete-user",
    "/api/auth/update-user",
    "/api/auth/sign-in/email",
    "/api/auth/error",
    "/api/auth/unknown/path",
  ])("returns 404 for %s (U-12)", async (path) => {
    const app = createApp();
    const getResponse = await request(app)
      .get(path)
      .set("origin", PUBLIC_ORIGIN);
    const postResponse = await request(app)
      .post(path)
      .set("origin", PUBLIC_ORIGIN)
      .set("content-type", "application/json")
      .send({});

    for (const response of [getResponse, postResponse]) {
      expect(response.status).toBe(404);
      expect(response.body).toMatchObject({ code: "NOT_FOUND" });
    }
  });

  // U-13: 公開経路でもメソッド違いは 404
  it.each([
    ["get", "/api/auth/sign-in/social"],
    ["put", "/api/auth/sign-in/social"],
    ["get", "/api/auth/sign-out"],
    ["post", "/api/auth/callback/google"],
    ["post", "/api/auth/error"],
  ] as const)("returns 404 for %s %s (U-13)", async (method, path) => {
    const agent = request(createApp());
    const response = await agent[method](path)
      .set("origin", PUBLIC_ORIGIN)
      .set("content-type", "application/json")
      .send({});

    expect(response.status).toBe(404);
  });

  // U-14: POST の公開経路は Origin 完全一致
  it.each(["sign-in/social", "sign-out"] as const)(
    "rejects POST /api/auth/%s without a matching Origin (U-14)",
    async (path) => {
      const app = createApp();

      const noOrigin = await request(app).post(`/api/auth/${path}`);
      const evilOrigin = await request(app)
        .post(`/api/auth/${path}`)
        .set("origin", EVIL_ORIGIN);
      const trailingSlash = await request(app)
        .post(`/api/auth/${path}`)
        .set("origin", `${PUBLIC_ORIGIN}/`);

      for (const response of [noOrigin, evilOrigin, trailingSlash]) {
        expect(response.status).toBe(403);
        expect(response.body).toMatchObject({ code: "FORBIDDEN_ORIGIN" });
      }
    },
  );

  it("does not require Origin on GET public routes", async () => {
    const response = await request(createApp())
      .get("/api/auth/callback/google")
      .set("origin", EVIL_ORIGIN);

    expect(response.status).toBe(HANDLER_STATUS);
  });

  describe("when auth is unavailable", () => {
    it("returns 503 AUTH_UNAVAILABLE on public routes", async () => {
      const app = createApp(false);

      const signIn = await request(app)
        .post("/api/auth/sign-in/social")
        .set("origin", PUBLIC_ORIGIN)
        .set("content-type", "application/json")
        .send({});
      const callback = await request(app).get("/api/auth/callback/google");

      for (const response of [signIn, callback]) {
        expect(response.status).toBe(503);
        expect(response.body).toMatchObject({ code: "AUTH_UNAVAILABLE" });
      }
    });

    it("still returns 404 for non-public routes", async () => {
      const response = await request(createApp(false)).get(
        "/api/auth/get-session",
      );

      expect(response.status).toBe(404);
    });
  });
});
