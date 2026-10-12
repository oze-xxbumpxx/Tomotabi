import { Test } from "@nestjs/testing";
import { LoggerModule } from "nestjs-pino";
import { afterEach, describe, expect, it } from "vitest";
import {
  AFTER_RESPONSE,
  type AfterResponse,
} from "../../src/adapter/after-response/after-response";
import { NotificationCompositionModule } from "../../src/composition/notification-composition.module";
import { InProcessAfterResponse } from "../../src/infrastructure/after-response/in-process-after-response";
import { VercelAfterResponse } from "../../src/infrastructure/after-response/vercel-after-response";

// IU-03: AFTER_RESPONSEはVERCEL=1のときだけVercelAfterResponseに差し替わる
describe("AFTER_RESPONSEの組み立て（IU-03）", () => {
  afterEach(() => {
    delete process.env.VERCEL;
  });

  async function compileModule(): Promise<AfterResponse> {
    const moduleRef = await Test.createTestingModule({
      imports: [LoggerModule.forRoot(), NotificationCompositionModule],
    }).compile();
    return moduleRef.get<AfterResponse>(AFTER_RESPONSE);
  }

  it("VERCEL=1のときVercelAfterResponseになる", async () => {
    process.env.VERCEL = "1";
    expect(await compileModule()).toBeInstanceOf(VercelAfterResponse);
  });

  it("VERCELが無いとき・1以外のときはInProcessAfterResponseのまま", async () => {
    delete process.env.VERCEL;
    expect(await compileModule()).toBeInstanceOf(InProcessAfterResponse);
    process.env.VERCEL = "0";
    expect(await compileModule()).toBeInstanceOf(InProcessAfterResponse);
  });
});
