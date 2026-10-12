import type { PoolClient } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { closePool, getPool } from "../../src/infrastructure/database/pool";

const mocks = vi.hoisted(() => ({ attachDatabasePool: vi.fn() }));
vi.mock("@vercel/functions", () => ({
  attachDatabasePool: mocks.attachDatabasePool,
}));

vi.mock("../../src/bootstrap/server-timing", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/bootstrap/server-timing")>();
  return { ...actual, addDbMs: vi.fn(actual.addDbMs) };
});

import { addDbMs, requestTiming } from "../../src/bootstrap/server-timing";

const DATABASE_URL = "postgres://user:pass@localhost:5432/unused";

afterEach(async () => {
  await closePool();
  delete process.env.VERCEL;
  delete process.env.DATABASE_URL;
  mocks.attachDatabasePool.mockClear();
  vi.mocked(addDbMs).mockClear();
});

// IU-05: attachDatabasePoolはVercelのときだけ、プールを作った直後に1回
describe("attachDatabasePool（IU-05）", () => {
  it("VERCEL=1のときプールを作った直後に1回だけ呼ばれる", () => {
    process.env.DATABASE_URL = DATABASE_URL;
    process.env.VERCEL = "1";

    const pool = getPool();
    expect(mocks.attachDatabasePool).toHaveBeenCalledTimes(1);
    expect(mocks.attachDatabasePool).toHaveBeenCalledWith(pool);

    expect(getPool()).toBe(pool);
    expect(mocks.attachDatabasePool).toHaveBeenCalledTimes(1);
  });

  it.each([["未設定"], ["0"], ["yes"]] as const)(
    "VERCEL=%sのときは呼ばれない",
    (value) => {
      process.env.DATABASE_URL = DATABASE_URL;
      if (value !== "未設定") {
        process.env.VERCEL = value;
      }
      getPool();
      expect(mocks.attachDatabasePool).not.toHaveBeenCalled();
    },
  );
});

// IU-06: 接続のqueryを包んで1回分だけ足す（pool.queryは包まない）
describe("DBの時間の計り方（IU-06）", () => {
  it("接続のqueryを1回呼ぶとdbの時間は1回分だけ足される", async () => {
    process.env.DATABASE_URL = DATABASE_URL;
    const pool = getPool();

    // pgのpool.queryは内部で接続のqueryをコールバック型で呼ぶ。
    // connectイベントで包まれる接続を、コールバック型とPromise型の
    // 両方に応える偽の接続でまねる。
    type QueryCallback = (error: null, result: { rows: unknown[] }) => void;
    const fakeClient = {
      query: (...args: unknown[]) => {
        const callback =
          args.find((arg): arg is QueryCallback => typeof arg === "function") ??
          null;
        const work = new Promise<{ rows: unknown[] }>((resolve) => {
          setTimeout(() => resolve({ rows: [] }), 5);
        });
        if (callback !== null) {
          void work.then((result) => callback(null, result));
          return;
        }
        return work;
      },
    };
    pool.emit("connect", fakeClient as unknown as PoolClient);

    const store = { start: 0, dbMs: 0 };
    await requestTiming.run(store, async () => {
      // pool.queryの中身と同じコールバック型の1回。
      await new Promise<void>((resolve, reject) => {
        fakeClient.query("SELECT 1", [], (error: null, _result: unknown) =>
          error === null ? resolve() : reject(error),
        );
      });
      // client.queryのPromise型の1回。
      await fakeClient.query("SELECT 1");
    });

    // 2つの形それぞれで1回だけ足される（二重に数えない）。
    expect(vi.mocked(addDbMs)).toHaveBeenCalledTimes(2);
    expect(store.dbMs).toBeGreaterThan(0);
  });
});
