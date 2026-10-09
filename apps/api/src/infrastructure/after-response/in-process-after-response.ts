import type { OnApplicationShutdown } from "@nestjs/common";
import type { AfterResponse } from "../../adapter/after-response/after-response";

/** 終了時にタスクの完了を待つ上限（設計書「リスク」: 最大5秒）。 */
const SHUTDOWN_DRAIN_TIMEOUT_MS = 5_000;

/**
 * 応答を返したあとにタスクを走らせる手元の実装（設計書
 * 「保存のあとの処理の口」）。タスクはsetImmediateで応答のあとに始め、
 * 走っているタスクを持っておき、例外はwarnログに出す。
 * 例外のmessageには宛先や鍵が入り得るため、ログは型名だけにする。
 * 終了のときはdrain()を最大5秒待つ。
 */
export class InProcessAfterResponse
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
      // 応答を返したあとに始める（publishを呼んだ処理の先で走らせない）。
      setImmediate(() => {
        task().then(
          () => resolve(),
          (error: unknown) => {
            this.logFailure({
              task: name,
              errorType:
                error instanceof Error ? error.constructor.name : typeof error,
            });
            resolve();
          },
        );
      });
    });
    this.running.add(tracked);
    void tracked.finally(() => {
      this.running.delete(tracked);
    });
  }

  async drain(): Promise<void> {
    // タスクの中からscheduleされる続きも取りこぼさないよう、空になるまで回す。
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
