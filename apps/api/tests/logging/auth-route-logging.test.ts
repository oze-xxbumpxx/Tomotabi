import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import { Writable } from "node:stream";
import { Logger } from "nestjs-pino";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { configureApp } from "../../src/bootstrap/configure-app";
import { createRequestLogger } from "../../src/infrastructure/logging/logger";

const ORIGIN = "http://localhost:3000";

const ALLOWED_KEYS = new Set([
  "level",
  "time",
  "requestId",
  "method",
  "path",
  "statusCode",
  "responseTime",
  "code",
]);

const SECRETS = {
  cookie: "travel.session_token=SECRET_COOKIE_VALUE",
  authorization: "Bearer SECRET_ACCESS_TOKEN",
  code: "SECRET_OAUTH_CODE",
  state: "SECRET_STATE",
} as const;

interface LogLine {
  level?: number;
  method?: string;
  path?: string;
  statusCode?: number;
  code?: string;
}

function createCaptureStream(): { stream: Writable; lines: () => string[] } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: string, _encoding, callback): void {
      chunks.push(chunk.toString());
      callback();
    },
  });
  return {
    stream,
    lines: (): string[] =>
      chunks.flatMap((chunk) => chunk.split("\n").filter((line) => line.length > 0)),
  };
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

function expectSingleSafeLine(lines: string[]): LogLine {
  expect(lines).toHaveLength(1);
  const raw = lines[0];
  for (const secret of Object.values(SECRETS)) {
    expect(raw).not.toContain(secret);
  }
  const line = JSON.parse(raw) as LogLine;
  for (const key of Object.keys(line)) {
    expect(ALLOWED_KEYS.has(key), `unexpected log key: ${key}`).toBe(true);
  }
  expect(line.path).not.toContain("?");
  return line;
}

describe("/api/auth/* の要求ログ（U-17 と同じ観点）", () => {
  let app: NestExpressApplication;
  let capture: ReturnType<typeof createCaptureStream>;
  let seen = 0;

  // 直前の要求から増えた行だけを見る
  function newLines(): string[] {
    const all = capture.lines();
    const fresh = all.slice(seen);
    seen = all.length;
    return fresh;
  }

  beforeAll(async () => {
    process.env.PUBLIC_APP_ORIGIN = ORIGIN;
    capture = createCaptureStream();
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    // auth は null（DATABASE_URL 無し）。経路制限は auth の有無に関係なく同じ位置で応答する。
    app = moduleRef.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    });
    configureApp(app, null, createRequestLogger(capture.stream));
    app.useLogger(app.get(Logger));
    await app.init();
  });

  beforeEach(() => {
    seen = capture.lines().length;
  });

  afterAll(async () => {
    await app.close();
    delete process.env.PUBLIC_APP_ORIGIN;
  });

  it("経路制限の 404 を 1 行で出し、code=NOT_FOUND を含む（cookie・authorization・query は出ない）", async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/auth/get-session?code=${SECRETS.code}&state=${SECRETS.state}`)
      .set("Cookie", SECRETS.cookie)
      .set("Authorization", SECRETS.authorization);
    expect(response.status).toBe(404);
    await flush();

    const line = expectSingleSafeLine(newLines());
    expect(line.method).toBe("GET");
    expect(line.path).toBe("/api/auth/get-session");
    expect(line.statusCode).toBe(404);
    expect(line.code).toBe("NOT_FOUND");
    expect(line.level).toBe(30);
  });

  it("経路制限の 403 を 1 行で出し、code=FORBIDDEN_ORIGIN を含む", async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/auth/sign-in/social?state=${SECRETS.state}`)
      .set("Origin", "http://evil.example.test")
      .set("Cookie", SECRETS.cookie)
      .set("Content-Type", "application/json")
      .send({ provider: "google" });
    expect(response.status).toBe(403);
    await flush();

    const line = expectSingleSafeLine(newLines());
    expect(line.method).toBe("POST");
    expect(line.path).toBe("/api/auth/sign-in/social");
    expect(line.statusCode).toBe(403);
    expect(line.code).toBe("FORBIDDEN_ORIGIN");
  });

  it("auth 未生成時の 503 も 1 行で出し、code=AUTH_UNAVAILABLE を含む", async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/auth/callback/google?code=${SECRETS.code}&state=${SECRETS.state}`)
      .set("Cookie", SECRETS.cookie);
    expect(response.status).toBe(503);
    await flush();

    const line = expectSingleSafeLine(newLines());
    expect(line.path).toBe("/api/auth/callback/google");
    expect(line.statusCode).toBe(503);
    expect(line.code).toBe("AUTH_UNAVAILABLE");
    expect(line.level).toBe(50);
  });

  it("Nest 側の経路も 1 行だけ出す（useExisting で二重に出ない）", async () => {
    const response = await request(app.getHttpServer())
      .get("/api/health")
      .set("Cookie", SECRETS.cookie);
    expect(response.status).toBe(200);
    await flush();

    const line = expectSingleSafeLine(newLines());
    expect(line.path).toBe("/api/health");
    expect(line.statusCode).toBe(200);
    expect(line.code).toBeUndefined();
  });
});
