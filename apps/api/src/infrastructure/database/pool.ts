import { attachDatabasePool } from "@vercel/functions";
import { performance } from "node:perf_hooks";
import type { PoolClient } from "pg";
import { Pool } from "pg";
import { requestTiming } from "../../bootstrap/server-timing";

let pool: Pool | undefined;

/**
 * pgのclient.queryがコールバック型で呼ばれたとき、応答時に時間を計る
 * コールバックに差し替える。差し替えるのはpgが応答のコールバックとして
 * 使う引数: 3番目のcallback、textとcbだけの形の2番目、configオブジェクトの
 * callbackプロパティ。
 */
function timeCallbackArgs(args: unknown[], onDone: () => void): unknown[] {
  const wrap = (fn: unknown): unknown =>
    function (this: unknown, ...cbArgs: unknown[]) {
      onDone();
      return (fn as (...a: unknown[]) => unknown).apply(this, cbArgs);
    };
  const timed = [...args];
  const [config, values, callback] = timed;
  if (typeof callback === "function") {
    timed[2] = wrap(callback);
  } else if (typeof values === "function") {
    timed[1] = wrap(values);
  } else if (
    typeof config === "object" &&
    config !== null &&
    typeof (config as { callback?: unknown }).callback === "function"
  ) {
    if (typeof (config as { submit?: unknown }).submit === "function") {
      // Submittableはpg自身がcallbackを書き換えるので、同じく差し替える。
      // 再実行はpgが止めるので、包みが重なることはない。
      (config as { callback: unknown }).callback = wrap(
        (config as { callback: unknown }).callback,
      );
    } else {
      // 設定のオブジェクトを使い回しても包みが重ならないよう、
      // callbackだけを包んだ複製を渡す。
      timed[0] = {
        ...(config as Record<string, unknown>),
        callback: wrap((config as { callback: unknown }).callback),
      };
    }
  }
  return timed;
}

/**
 * 新しい接続のqueryを包み、問い合わせの時間をServer-Timingの入れ物に足す
 * （設計書「時間の内訳の測り方」）。pool.queryは内部で接続のqueryを
 * コールバック型で呼ぶので、接続側だけを包んで二重に数えない。
 */
function wrapClientQueryForTiming(client: PoolClient): void {
  const original = client.query;
  client.query = function (this: PoolClient, ...args: unknown[]): unknown {
    // 応答は接続のソケット由来の文脈で通知されるため、その時点の文脈が
    // 問い合わせを始めた要求とは限らない。開始時点の入れ物を捕まえて、
    // その入れ物にだけ足す。要求の文脈の外（入れ物が無い）では数えない。
    const store = requestTiming.getStore();
    const started = performance.now();
    const onDone = (): void => {
      if (store !== undefined) {
        store.dbMs += performance.now() - started;
      }
    };
    const result = (original as (...a: unknown[]) => unknown).apply(
      this,
      timeCallbackArgs(args, onDone),
    );
    if (result instanceof Promise) {
      return result.finally(onDone);
    }
    return result;
  } as PoolClient["query"];
}

export function getPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  if (!pool) {
    pool = new Pool({
      connectionString,
      max: 2,
      idleTimeoutMillis: 5_000,
      connectionTimeoutMillis: 10_000,
    });
    // アイドル接続の非同期エラー（DB停止等）を握りつぶす。listenerが無いと
    // EventEmitterのerrorイベントがプロセスを落とす。実クエリの失敗は
    // 各呼び出しのrejectで処理する。
    pool.on("error", () => {});
    pool.on("connect", wrapClientQueryForTiming);
    // 使わない接続を関数の休止に合わせて手放す。Vercelのときだけ
    // （設計書「DB 設計」）。
    if (process.env.VERCEL === "1") {
      attachDatabasePool(pool);
    }
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (!pool) {
    return;
  }
  await pool.end();
  pool = undefined;
}
