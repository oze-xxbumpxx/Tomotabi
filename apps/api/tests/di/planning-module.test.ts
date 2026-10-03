import { Test, type TestingModule } from "@nestjs/testing";
import { afterEach, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { UserId } from "../../src/common/domain/user-id";
import {
  PLANNING_READ_PORT,
  type PlanningReadPort,
} from "../../src/modules/planning/adapter/outbound/planning-read.port";

describe("PlanningModule DI", () => {
  const saved = process.env.DATABASE_URL;
  let moduleRef: TestingModule | undefined;

  afterEach(async () => {
    await moduleRef?.close();
    moduleRef = undefined;
    if (saved === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = saved;
    }
  });

  it("DATABASE_URL が空文字でも AppModule を組める（未設定と同じ扱い）", async () => {
    // .env.exampleの`DATABASE_URL=`は空文字。空文字を「DBあり」と
    // 誤認するとgetPool()が起動時に失敗してAPI全体が上がらない。
    process.env.DATABASE_URL = "";
    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    const read = moduleRef.get<PlanningReadPort>(PLANNING_READ_PORT);
    await expect(
      read.listTripsForParticipant(
        UserId.parse("00000000-0000-4000-8000-000000000001"),
        { status: null, after: null, limit: 10 },
      ),
    ).rejects.toThrow("DATABASE_URL is not set");
  });

  it("DATABASE_URL が未設定でも AppModule を組める", async () => {
    delete process.env.DATABASE_URL;
    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    expect(moduleRef).toBeDefined();
  });
});
