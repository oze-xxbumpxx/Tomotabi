import { Controller, Get, Module } from "@nestjs/common";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Writable } from "node:stream";
import { Logger, LoggerModule } from "nestjs-pino";
import { describe, expect, it } from "vitest";
import { createPinoHttpOptions } from "../../src/infrastructure/logging/logger";

const DB_URL = "postgres://app:SECRETPW@db.internal.example:5432/tomotabi";

@Controller()
class ExplodingController {
  @Get("explode")
  explode(): never {
    throw new Error(`connect failed ${DB_URL}`);
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

describe("exception logging through the Nest application", () => {
  it("U-18: ExceptionsHandler 経由でも例外の message / stack / DB URL を出さない", async () => {
    const capture = createCaptureStream();

    @Module({
      imports: [
        LoggerModule.forRoot({ pinoHttp: [createPinoHttpOptions(), capture.stream] }),
      ],
      controllers: [ExplodingController],
    })
    class TestModule {}

    const moduleRef = await Test.createTestingModule({ imports: [TestModule] }).compile();
    const app: INestApplication = moduleRef.createNestApplication();
    app.useLogger(app.get(Logger));
    app.setGlobalPrefix("api");
    await app.init();
    await app.listen(0);

    try {
      const baseUrl = (await app.getUrl()).replace("[::1]", "127.0.0.1");
      const response = await fetch(`${baseUrl}/api/explode`);
      expect(response.status).toBe(500);
      // HttpException 応答の形は変えない
      expect(await response.json()).toEqual({
        statusCode: 500,
        message: "Internal server error",
      });
    } finally {
      await app.close();
    }

    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });

    const lines = capture.lines();
    const whole = lines.join("\n");

    // 起動ログを含む全行に URL や例外メッセージの断片が出ない
    for (const fragment of ["SECRETPW", "postgres://", "db.internal.example", "connect failed"]) {
      expect(whole).not.toContain(fragment);
    }

    // ExceptionsHandler の行: err は type と errorCode だけを持ち、message / stack を持たない
    const exceptionLines = lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((line) => "err" in line);
    expect(exceptionLines.length).toBeGreaterThan(0);
    for (const line of exceptionLines) {
      const err = line.err as Record<string, unknown>;
      expect(err.type).toBe("Error");
      expect(err.errorCode).toBe("INTERNAL_ERROR");
      expect(err).not.toHaveProperty("message");
      expect(err).not.toHaveProperty("stack");
      // msg への err.message 自動転記も止まっている
      expect(line.msg).toBe("unhandled exception");
    }

    // リクエスト行は既知の code だけを出す（ExceptionsHandler 行も requestId を持つので method で絞る）
    const requestLines = lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((line) => "method" in line);
    expect(requestLines).toHaveLength(1);
    expect(requestLines[0].code).toBe("INTERNAL_ERROR");
    expect(requestLines[0].statusCode).toBe(500);
    expect(requestLines[0].level).toBe(50);
    expect(requestLines[0].path).toBe("/api/explode");
  });
});
