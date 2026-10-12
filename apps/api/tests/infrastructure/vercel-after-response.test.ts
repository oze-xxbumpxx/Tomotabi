import { describe, expect, it, vi } from "vitest";
import { VercelAfterResponse } from "../../src/infrastructure/after-response/vercel-after-response";

const mocks = vi.hoisted(() => ({ waitUntil: vi.fn() }));
vi.mock("@vercel/functions", () => ({ waitUntil: mocks.waitUntil }));

// IU-01・IU-02: VercelのAfterResponse（waitUntil・例外を外に出さない）
describe("VercelAfterResponse（IU-01・IU-02）", () => {
  function setup() {
    const failures: { task: string; errorType: string }[] = [];
    const afterResponse = new VercelAfterResponse((entry) =>
      failures.push(entry),
    );
    return { afterResponse, failures };
  }

  it("scheduleの中では仕事が始まらず、次の順番（setImmediate）で始まる", async () => {
    const { afterResponse } = setup();
    const order: string[] = [];
    afterResponse.schedule("task-a", async () => {
      order.push("a");
    });
    order.push("returned");
    expect(order).toEqual(["returned"]);
    // setImmediateの順番が回ると仕事が始まっている。
    await new Promise((resolve) => setImmediate(resolve));
    expect(order).toEqual(["returned", "a"]);
  });

  it("scheduleは仕事の約束をwaitUntilに渡してすぐ戻り、drainは全部終わるまで待つ", async () => {
    mocks.waitUntil.mockClear();
    const { afterResponse } = setup();
    const order: string[] = [];
    afterResponse.schedule("task-b", async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      order.push("b");
    });
    order.push("returned");
    expect(order).toEqual(["returned"]);

    expect(mocks.waitUntil).toHaveBeenCalledTimes(1);
    const passed = mocks.waitUntil.mock.calls[0]?.[0] as Promise<void>;
    expect(passed).toBeInstanceOf(Promise);

    await afterResponse.drain();
    expect(order).toEqual(["returned", "b"]);
    await passed;
  });

  it("仕事が例外・拒否になっても呼び出し側に伝わらず、ログは型名だけ（messageは出ない）", async () => {
    const { afterResponse, failures } = setup();
    afterResponse.schedule("task-fail", async () => {
      throw new TypeError("secret endpoint should not leak");
    });
    afterResponse.schedule("task-reject", () =>
      Promise.reject(new RangeError("another secret")),
    );
    await afterResponse.drain();
    expect(failures).toEqual([
      { task: "task-fail", errorType: "TypeError" },
      { task: "task-reject", errorType: "RangeError" },
    ]);
    expect(JSON.stringify(failures)).not.toContain("secret");
  });
});
