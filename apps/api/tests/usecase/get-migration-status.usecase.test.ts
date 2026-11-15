import { describe, expect, it } from "vitest";
import type { Clock } from "../../src/adapter/clock/clock";
import { LocalDate } from "../../src/common/domain/local-date";
import type { MigrationStatusReader } from "../../src/modules/foundation/adapter/outbound/migration-status.port";
import {
  GetMigrationStatusUseCase,
  MIGRATION_STATUS_CACHE_MS,
} from "../../src/modules/foundation/usecase/get-migration-status.usecase";

class FakeClock implements Clock {
  constructor(public ms: number) {}
  now(): Date {
    return new Date(this.ms);
  }
  today(): LocalDate {
    return LocalDate.parse("2026-11-13");
  }
}

class CountingReader implements MigrationStatusReader {
  calls = 0;
  results: Array<() => Promise<number | null>> = [];
  lastAppliedAt(): Promise<number | null> {
    this.calls += 1;
    const next = this.results.shift();
    return next === undefined ? Promise.resolve(1) : next();
  }
}

describe("最後に流したmigrationの時刻を、DBを読みすぎずに返す", () => {
  it("MD-45: 覚えている間はDBを読まず、過ぎたら読み直す", async () => {
    const clock = new FakeClock(0);
    const reader = new CountingReader();
    reader.results = [() => Promise.resolve(1), () => Promise.resolve(2)];
    const useCase = new GetMigrationStatusUseCase(reader, clock);

    await expect(useCase.execute()).resolves.toEqual({ lastAppliedAt: 1 });
    clock.ms = MIGRATION_STATUS_CACHE_MS - 1;
    await expect(useCase.execute()).resolves.toEqual({ lastAppliedAt: 1 });
    expect(reader.calls).toBe(1);

    clock.ms = MIGRATION_STATUS_CACHE_MS;
    await expect(useCase.execute()).resolves.toEqual({ lastAppliedAt: 2 });
    expect(reader.calls).toBe(2);
  });

  it("MD-46: 同時に来た要求は、DBを1回だけ読んで同じ答えを返す", async () => {
    const reader = new CountingReader();
    let release: (value: number | null) => void = () => {};
    reader.results = [
      () =>
        new Promise<number | null>((resolve) => {
          release = resolve;
        }),
    ];
    const useCase = new GetMigrationStatusUseCase(reader, new FakeClock(0));

    const pending = Array.from({ length: 20 }, () => useCase.execute());
    release(7);

    const views = await Promise.all(pending);
    expect(reader.calls).toBe(1);
    expect(views.every((view) => view.lastAppliedAt === 7)).toBe(true);
  });

  it("MD-47: 読めなかったときは覚えず、次の要求で読み直す", async () => {
    const reader = new CountingReader();
    reader.results = [
      () => Promise.reject(new Error("permission denied")),
      () => Promise.resolve(3),
    ];
    const useCase = new GetMigrationStatusUseCase(reader, new FakeClock(0));

    await expect(useCase.execute()).rejects.toThrow("permission denied");
    await expect(useCase.execute()).resolves.toEqual({ lastAppliedAt: 3 });
    expect(reader.calls).toBe(2);
  });
});
