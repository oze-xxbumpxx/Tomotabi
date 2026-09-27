import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { PublicRoute } from "../../src/common/guard/public-route.decorator";
import { ApiError } from "../../src/common/http/api-error";
import { IDENTITY_READER } from "../../src/modules/identity/adapter/outbound/identity-reader";
import {
  SESSION_VERIFIER,
  type SessionVerifier,
} from "../../src/modules/identity/adapter/outbound/session-verifier";
import { createHttpTestApp } from "../support/nest-app";

const ORIGIN = "http://localhost:3000";
const DB_URL = "postgres://app:SECRETPW@db.internal.example:5432/tomotabi";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

@Controller("error-test")
class ErrorTestController {
  @PublicRoute()
  @Get("api-error")
  apiError(): never {
    throw new ApiError({
      code: "TRIP_NOT_ACCESSIBLE",
      status: 403,
      message: "Trip is not accessible",
    });
  }

  @PublicRoute()
  @Get("coded-http-exception")
  codedHttpException(): never {
    throw new ServiceUnavailableException({
      code: "AUTH_UNAVAILABLE",
      message: "Authentication is temporarily unavailable",
    });
  }

  @PublicRoute()
  @Get("unexpected")
  unexpected(): never {
    throw new Error(`connect failed ${DB_URL}`);
  }

  @PublicRoute()
  @Get("db-unavailable")
  dbUnavailable(): never {
    throw Object.assign(new Error(`connect failed ${DB_URL}`), {
      code: "ECONNREFUSED",
    });
  }
}

describe("ApiErrorFilter（U-15。configure-app で組んだアプリ）", () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.PUBLIC_APP_ORIGIN = ORIGIN;
    const verifier: SessionVerifier = {
      verify: async () => ({ kind: "unauthenticated" }),
    };
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ErrorTestController],
    })
      .overrideProvider(SESSION_VERIFIER)
      .useValue(verifier)
      .overrideProvider(IDENTITY_READER)
      .useValue({ findDisplayName: async () => "ひなた" })
      .compile();
    app = await createHttpTestApp(moduleRef, null);
  });

  afterAll(async () => {
    await app.close();
    delete process.env.PUBLIC_APP_ORIGIN;
  });

  it("ApiError はその code・状態・retryable を応答する", async () => {
    const response = await request(app.getHttpServer()).get(
      "/api/error-test/api-error",
    );
    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      code: "TRIP_NOT_ACCESSIBLE",
      message: "Trip is not accessible",
      requestId: expect.stringMatching(UUID_PATTERN),
      retryable: false,
    });
  });

  it("code を持つ HttpException は code を保ち、503 は retryable=true", async () => {
    const response = await request(app.getHttpServer()).get(
      "/api/error-test/coded-http-exception",
    );
    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      code: "AUTH_UNAVAILABLE",
      message: "Authentication is temporarily unavailable",
      requestId: expect.stringMatching(UUID_PATTERN),
      retryable: true,
    });
  });

  it("M1 の Guard の例外も新しい形になり、code は変わらない", async () => {
    const response = await request(app.getHttpServer()).get("/api/me");
    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      code: "UNAUTHENTICATED",
      message: "Authentication required",
      requestId: expect.stringMatching(UUID_PATTERN),
      retryable: false,
    });
  });

  it("Origin 不一致の 403 も新しい形になる", async () => {
    const response = await request(app.getHttpServer())
      .post("/api/foundation/probes/increment")
      .set("content-type", "application/json")
      .send({});
    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      code: "FORBIDDEN_ORIGIN",
      message: "Origin is not allowed",
      requestId: expect.stringMatching(UUID_PATTERN),
      retryable: false,
    });
  });

  it("想定外の例外は 500 INTERNAL_ERROR で、message・スタック・接続情報を出さない", async () => {
    const response = await request(app.getHttpServer()).get(
      "/api/error-test/unexpected",
    );
    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      code: "INTERNAL_ERROR",
      message: "Internal server error",
      requestId: expect.stringMatching(UUID_PATTERN),
      retryable: false,
    });
    const raw = JSON.stringify(response.body) + response.text;
    for (const fragment of ["SECRETPW", "postgres://", "db.internal.example", "connect failed", "Error:"]) {
      expect(raw).not.toContain(fragment);
    }
  });

  it("DB 接続の失敗は 503 TEMPORARILY_UNAVAILABLE retryable=true", async () => {
    const response = await request(app.getHttpServer()).get(
      "/api/error-test/db-unavailable",
    );
    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      code: "TEMPORARILY_UNAVAILABLE",
      message: "Service is temporarily unavailable",
      requestId: expect.stringMatching(UUID_PATTERN),
      retryable: true,
    });
    expect(response.text).not.toContain("SECRETPW");
  });
});
