import type { PoolClient } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { closePool, getPool } from "../../src/infrastructure/database/pool";

const mocks = vi.hoisted(() => ({ attachDatabasePool: vi.fn() }));
vi.mock("@vercel/functions", () => ({
  attachDatabasePool: mocks.attachDatabasePool,
}));

import { requestTiming } from "../../src/bootstrap/server-timing";
import type { RequestTiming } from "../../src/bootstrap/server-timing";

const DATABASE_URL = "postgres://user:pass@localhost:5432/unused";

afterEach(async () => {
  await closePool();
  delete process.env.VERCEL;
  delete process.env.DATABASE_URL;
  mocks.attachDatabasePool.mockClear();
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

type QueryCallback = (error: null, result: { rows: unknown[] }) => void;

/**
 * pgのpool.queryは内部で接続のqueryをコールバック型で呼ぶ。connectイベントで
 * 包まれる接続を、コールバック型（引数・configオブジェクト）とPromise型の
 * 両方に応える偽の接続でまねる。
 */
function makeFakeClient() {
  const calls: unknown[][] = [];
  return {
    calls,
    query: (...args: unknown[]) => {
      calls.push(args);
      const [config] = args;
      const callback =
        args.find((arg): arg is QueryCallback => typeof arg === "function") ??
        (typeof config === "object" && config !== null
          ? ((config as { callback?: QueryCallback }).callback ?? null)
          : null);
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
}

/**
 * dbMsへの代入を数える入れ物。1回の問い合わせで何回足されたかを、
 * 時間の大きさではなく回数で確かめる。
 */
function countingStore() {
  const increments: number[] = [];
  const store = new Proxy<RequestTiming>(
    { start: 0, dbMs: 0 },
    {
      set(target, prop, value) {
        if (prop === "dbMs") {
          increments.push(value as number);
        }
        return Reflect.set(target, prop, value);
      },
    },
  );
  return { store, increments };
}

// IU-06: 接続のqueryを包んで1回分だけ足す（pool.queryは包まない）
describe("DBの時間の計り方（IU-06）", () => {
  it("接続のqueryを1回呼ぶとdbの時間は1回分だけ足される", async () => {
    process.env.DATABASE_URL = DATABASE_URL;
    const pool = getPool();
    const fakeClient = makeFakeClient();
    pool.emit("connect", fakeClient as unknown as PoolClient);

    const { store, increments } = countingStore();
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
    expect(increments).toHaveLength(2);
    expect(store.dbMs).toBeGreaterThan(0);
  });

  it("同じ設定オブジェクトを使い回しても1回ずつしか足されない", async () => {
    process.env.DATABASE_URL = DATABASE_URL;
    const pool = getPool();
    const fakeClient = makeFakeClient();
    pool.emit("connect", fakeClient as unknown as PoolClient);

    const { store, increments } = countingStore();
    const originalCallback = vi.fn();
    const config = { text: "SELECT 1", callback: originalCallback };
    await requestTiming.run(store, async () => {
      fakeClient.query(config);
      fakeClient.query(config);
      await vi.waitFor(() => expect(originalCallback).toHaveBeenCalledTimes(2));
    });

    // 包みが重ならず、2回の問い合わせで2回だけ足される。
    expect(increments).toHaveLength(2);
    // 呼び出し側のconfigは書き換わっていない。
    expect(config.callback).toBe(originalCallback);
  });

  it("応答が別の文脈で通知されても、始めた要求の入れ物にだけ足される", async () => {
    process.env.DATABASE_URL = DATABASE_URL;
    const pool = getPool();
    const other = { store: { start: 0, dbMs: 0 } as RequestTiming };
    // 接続のソケット由来で応答が返る（=別の要求の文脈）のを、
    // コールバックを別の入れ物で包んで呼ぶことでまねる。
    const fakeClient = {
      query: (...args: unknown[]) => {
        const callback = args.find(
          (arg): arg is QueryCallback => typeof arg === "function",
        );
        setTimeout(
          () => requestTiming.run(other.store, () => callback?.(null, { rows: [] })),
          5,
        );
      },
    };
    pool.emit("connect", fakeClient as unknown as PoolClient);

    const { store, increments } = countingStore();
    await requestTiming.run(store, async () => {
      await new Promise<void>((resolve, reject) => {
        fakeClient.query("SELECT 1", [], (error: null, _result: unknown) =>
          error === null ? resolve() : reject(error),
        );
      });
    });

    expect(increments).toHaveLength(1);
    expect(store.dbMs).toBeGreaterThan(0);
    expect(other.store.dbMs).toBe(0);
  });
});
