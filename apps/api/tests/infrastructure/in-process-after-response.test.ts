import { describe, expect, it } from "vitest";
import { InProcessAfterResponse } from "../../src/infrastructure/after-response/in-process-after-response";

// PU-09: 保存のあとの処理の口
describe("InProcessAfterResponse（PU-09）", () => {
  function setup() {
    const failures: { task: string; errorType: string }[] = [];
    const afterResponse = new InProcessAfterResponse((entry) =>
      failures.push(entry),
    );
    return { afterResponse, failures };
  }

  it("scheduleしたタスクは応答のあとに走り、drainで全部終わるまで待てる", async () => {
    const { afterResponse } = setup();
    const order: string[] = [];
    afterResponse.schedule("task-a", async () => {
      order.push("a");
    });
    order.push("returned");
    expect(order).toEqual(["returned"]);
    await afterResponse.drain();
    expect(order).toEqual(["returned", "a"]);
  });

  it("タスクの例外は外に出さずログに出す（型名だけ）", async () => {
    const { afterResponse, failures } = setup();
    afterResponse.schedule("task-fail", async () => {
      throw new TypeError("secret endpoint should not leak");
    });
    await afterResponse.drain();
    expect(failures).toEqual([
      { task: "task-fail", errorType: "TypeError" },
    ]);
    expect(JSON.stringify(failures)).not.toContain("secret");
  });

  it("drainはタスクの中から予約された続きも待つ", async () => {
    const { afterResponse } = setup();
    const done: string[] = [];
    afterResponse.schedule("outer", async () => {
      done.push("outer");
      afterResponse.schedule("inner", async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        done.push("inner");
      });
    });
    await afterResponse.drain();
    expect(done).toEqual(["outer", "inner"]);
  });

  it("終了時の待機（onApplicationShutdown）は最長5秒で打ち切る", async () => {
    const { afterResponse } = setup();
    afterResponse.schedule(
      "hanging",
      () => new Promise<void>(() => {}), // 終わらないタスク
    );
    const started = Date.now();
    await afterResponse.onApplicationShutdown();
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(6_000);
  }, 10_000);
});
