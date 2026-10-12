import { AsyncLocalStorage } from "node:async_hooks";
import type { ServerResponse } from "node:http";
import { performance } from "node:perf_hooks";
import type { RequestHandler } from "express";

/**
 * 要求ごとの時間の内訳の入れ物（設計書「時間の内訳の測り方」）。
 * startは要求の受け取り、dbMsはその要求でのDBの問い合わせの合計。
 */
export type RequestTiming = {
  readonly start: number;
  dbMs: number;
};

export const requestTiming = new AsyncLocalStorage<RequestTiming>();

/**
 * DBの問い合わせにかかった時間を足す。要求の文脈の外（入れ物が無い）では
 * 何もしない。
 */
export function addDbMs(ms: number): void {
  const store = requestTiming.getStore();
  if (store) {
    store.dbMs += ms;
  }
}

/**
 * 応答のヘッダーが書かれる直前にlistenerを1回だけ動かす（on-headersの形）。
 * res.writeHeadは応答のたびに必ず呼ばれるので、そこに差し込む。
 */
export function onBeforeWriteHead(
  res: ServerResponse,
  listener: () => void,
): void {
  const original = res.writeHead;
  let fired = false;
  res.writeHead = function (this: ServerResponse, ...args: unknown[]): unknown {
    if (!fired) {
      fired = true;
      listener();
    }
    return (original as (...a: unknown[]) => unknown).apply(this, args);
  } as ServerResponse["writeHead"];
}

// 関数の実行の単位（インスタンス）が起動してから最初の要求か。モジュールの
// 読み込みでtrue、最初の要求でfalseに変える（設計書「時間の内訳の測り方」）。
let coldStart = true;

// 小さい値が0に丸まらないよう小数を残す（実DBの観点ID-01でdb>0を確かめる）。
function formatDuration(ms: number): string {
  return String(Math.round(ms * 100) / 100);
}

/**
 * 全部の/apiの応答にServer-Timingを付けるミドルウェア。
 * configureAppの先頭（要求のログの直後、認証の経路の前）に置く。
 * 値は時間と真偽だけ（SQLや中身は入れない。設計書「セキュリティ」）。
 */
export const serverTiming: RequestHandler = (_req, res, next) => {
  const store: RequestTiming = { start: performance.now(), dbMs: 0 };
  const isCold = coldStart;
  coldStart = false;
  const bootMs = isCold ? process.uptime() * 1_000 : null;
  onBeforeWriteHead(res, () => {
    const parts = [
      `app;dur=${formatDuration(performance.now() - store.start)}`,
      `db;dur=${formatDuration(store.dbMs)}`,
      `cold;desc="${isCold}"`,
    ];
    if (bootMs !== null) {
      parts.push(`boot;dur=${formatDuration(bootMs)}`);
    }
    res.setHeader("Server-Timing", parts.join(", "));
  });
  requestTiming.run(store, () => next());
};
