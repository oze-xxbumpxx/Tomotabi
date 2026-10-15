import type { OnApplicationShutdown } from "@nestjs/common";
import { waitUntil } from "@vercel/functions";
import type { AfterResponse } from "../../adapter/after-response/after-response.js";

/** 終了時にタスクの完了を待つ上限（InProcessAfterResponseと同じ）。 */
const SHUTDOWN_DRAIN_TIMEOUT_MS = 5_000;

/**
 * 応答を返したあとにタスクを走らせるVercelの実装（設計書
 * 「Vercelのときに差し替える部品」）。InProcessAfterResponseと同じく
 * setImmediateで応答のあとに仕事を始め、例外は型名だけのログに変える。
 * 加えてその約束をwaitUntilに渡し、関数が応答を返したあとも仕事の
 * 終わりまで止まらないようにする。
 */
export class VercelAfterResponse
  implements AfterResponse, OnApplicationShutdown
{
  private readonly running = new Set<Promise<void>>();

  constructor(
    private readonly logFailure: (entry: {
      task: string;
      errorType: string;
    }) => void,
  ) {}

  schedule(name: string, task: () => Promise<void>): void {
    const tracked = new Promise<void>((resolve) => {
      // 応答を返したあとに始める（scheduleの中でtaskを呼ばない）。
      // Promise.resolve().then(task)で、taskが同期的に例外を投げても
      // ログに変わる。
      setImmediate(() => {
        void Promise.resolve()
          .then(task)
          .then(
            () => resolve(),
            (error: unknown) => {
              this.logFailure({
                task: name,
                errorType:
                  error instanceof Error
                    ? error.constructor.name
                    : typeof error,
              });
              resolve();
            },
          );
      });
    });
    waitUntil(tracked);
    this.running.add(tracked);
    void tracked.finally(() => {
      this.running.delete(tracked);
    });
  }

  async drain(): Promise<void> {
    while (this.running.size > 0) {
      await Promise.allSettled([...this.running]);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.drain(),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, SHUTDOWN_DRAIN_TIMEOUT_MS);
          timer.unref();
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
}
