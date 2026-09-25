import http from "node:http";
import type { AddressInfo } from "node:net";
import { Writable } from "node:stream";
import { pinoHttp } from "pino-http";
import { describe, expect, it } from "vitest";
import { createPinoHttpOptions } from "../../src/infrastructure/logging/logger";

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

interface LogLine {
  level?: number;
  requestId?: unknown;
  method?: string;
  path?: string;
  statusCode?: number;
  responseTime?: number;
  code?: string;
}

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;

function parse(line: string): LogLine {
  return JSON.parse(line) as LogLine;
}

function expectOnlyAllowedKeys(line: LogLine): void {
  for (const key of Object.keys(line)) {
    expect(ALLOWED_KEYS.has(key)).toBe(true);
  }
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

async function withLoggedServer(
  handler: Handler,
  run: (baseUrl: string) => Promise<void>,
): Promise<string[]> {
  const capture = createCaptureStream();
  const middleware = pinoHttp(createPinoHttpOptions(), capture.stream);
  const server = http.createServer((req, res) => {
    middleware(req, res, () => handler(req, res));
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const { port } = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  }
  await flush();
  return capture.lines();
}

describe("request logging", () => {
  it("U-17: 許可項目だけを 1 行に出し、cookie・authorization・set-cookie・code・sub を出さない", async () => {
    const lines = await withLoggedServer(
      (_req, res) => {
        res.setHeader("set-cookie", "travel.session_token=SECRET_SET_COOKIE; HttpOnly");
        res.statusCode = 403;
        res.end("denied");
      },
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/me?code=SECRET_OAUTH_CODE&state=SECRET_STATE&sub=SECRET_SUB`,
          {
            headers: {
              cookie: "travel.session_token=SECRET_COOKIE_VALUE",
              authorization: "Bearer SECRET_ACCESS_TOKEN",
            },
          },
        );
        await response.text();
      },
    );

    expect(lines).toHaveLength(1);
    const raw = lines[0];
    for (const secret of [
      "SECRET_COOKIE_VALUE",
      "SECRET_ACCESS_TOKEN",
      "SECRET_SET_COOKIE",
      "SECRET_OAUTH_CODE",
      "SECRET_STATE",
      "SECRET_SUB",
    ]) {
      expect(raw).not.toContain(secret);
    }

    const line = parse(raw);
    expectOnlyAllowedKeys(line);
    expect(line.method).toBe("GET");
    expect(line.path).toBe("/api/me");
    expect(line.path).not.toContain("?");
    expect(line.statusCode).toBe(403);
    expect(line.level).toBe(30);
    expect(typeof line.requestId).toBe("number");
    expect(typeof line.responseTime).toBe("number");
    // Guard の結果コードが無いときは code を出さない
    expect(line.code).toBeUndefined();
  });

  it("U-17: Guard の結果コードが res.locals.code にあるときだけ code を出す", async () => {
    const lines = await withLoggedServer(
      (_req, res) => {
        (res as { locals?: { code?: string } }).locals = { code: "UNAUTHENTICATED" };
        res.statusCode = 401;
        res.end("unauthenticated");
      },
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/me`);
        await response.text();
      },
    );

    expect(lines).toHaveLength(1);
    const line = parse(lines[0]);
    expectOnlyAllowedKeys(line);
    expect(line.code).toBe("UNAUTHENTICATED");
    expect(line.level).toBe(30);
  });

  it("U-18: message に DB URL を含む例外は既知の code だけを出し、URL を出さない", async () => {
    const dbUrl = "postgres://user:password@db.internal.example:5432/tomotabi";
    const lines = await withLoggedServer(
      (req, res) => {
        if (req.url === "/api/with-error") {
          (res as { err?: Error }).err = new Error(`connection failed: ${dbUrl}`);
        }
        res.statusCode = 500;
        res.end("error");
      },
      async (baseUrl) => {
        const withError = await fetch(`${baseUrl}/api/with-error`);
        await withError.text();
        const withoutError = await fetch(`${baseUrl}/api/without-error`);
        await withoutError.text();
      },
    );

    expect(lines).toHaveLength(2);
    for (const raw of lines) {
      expect(raw).not.toContain("postgres://");
      expect(raw).not.toContain("db.internal.example");
      expect(raw).not.toContain("connection failed");
      const line = parse(raw);
      expectOnlyAllowedKeys(line);
      expect(line.code).toBe("INTERNAL_ERROR");
      expect(line.statusCode).toBe(500);
      expect(line.level).toBe(50);
    }
  });

  it("U-17: req / res / 任意のオブジェクトを直接ログに渡しても redact で秘密を伏せる", async () => {
    const capture = createCaptureStream();
    const middleware = pinoHttp(createPinoHttpOptions(), capture.stream);
    middleware.logger.info({
      req: {
        headers: {
          cookie: "SECRET_COOKIE_VALUE",
          authorization: "Bearer SECRET_ACCESS_TOKEN",
        },
      },
      res: { headers: { "set-cookie": "SECRET_SET_COOKIE" } },
      payload: {
        token: "SECRET_TOKEN",
        accessToken: "SECRET_ACCESS_TOKEN",
        idToken: "SECRET_ID_TOKEN",
        refreshToken: "SECRET_REFRESH_TOKEN",
        code: "SECRET_CODE",
        sub: "SECRET_SUB",
      },
    });
    await flush();

    const lines = capture.lines();
    expect(lines).toHaveLength(1);
    const raw = lines[0];
    for (const secret of [
      "SECRET_COOKIE_VALUE",
      "SECRET_ACCESS_TOKEN",
      "SECRET_SET_COOKIE",
      "SECRET_TOKEN",
      "SECRET_ID_TOKEN",
      "SECRET_REFRESH_TOKEN",
      "SECRET_CODE",
      "SECRET_SUB",
    ]) {
      expect(raw).not.toContain(secret);
    }
    expect(raw).toContain("[Redacted]");
  });
});
