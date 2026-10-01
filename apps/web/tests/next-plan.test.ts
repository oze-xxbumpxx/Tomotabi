import { describe, expect, it } from "vitest";
import type { Plan } from "@tomotabi/contracts";
import {
  minutesUntilPlan,
  nextPlanOf,
  nowLineIndexOf,
} from "@/features/plans";

const tripId = "8a6e0804-2bd0-4672-b79d-d97027f9071a";
const userId = "550e8400-e29b-41d4-a716-446655440000";

function plan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: "6d6a86a1-6d0b-4c0f-9bb9-9a1d3a9e9c01",
    tripId,
    name: "錦市場で昼食",
    kind: "food",
    date: "2026-10-13",
    time: "12:00",
    memo: null,
    cancelledAt: null,
    cancelledBy: null,
    version: "1",
    achievement: null,
    booking: null,
    canChangeKind: true,
    kindChangeReason: null,
    ...overrides,
  };
}

// 2026-10-13 09:41（日本時間）= 2026-10-13T00:41:00Z
const now = new Date("2026-10-13T00:41:00.000Z");

describe("minutesUntilPlan（今日の今以降までの分数）", () => {
  it("今日の今以降の予定は残り分数を返す", () => {
    // 09:41 → 12:00 は 2 時間 19 分。
    expect(minutesUntilPlan(plan(), now)).toBe(139);
  });

  it("今日でない日の予定は null", () => {
    expect(
      minutesUntilPlan(plan({ date: "2026-10-14" }), now),
    ).toBeNull();
    expect(
      minutesUntilPlan(plan({ date: "2026-10-12", time: "23:59" }), now),
    ).toBeNull();
  });

  it("取りやめ済み・時刻未定・時刻が過ぎた予定は null", () => {
    expect(
      minutesUntilPlan(
        plan({ cancelledAt: "2026-10-13T08:00:00.000Z", cancelledBy: userId }),
        now,
      ),
    ).toBeNull();
    expect(minutesUntilPlan(plan({ time: null }), now)).toBeNull();
    expect(minutesUntilPlan(plan({ time: "09:00" }), now)).toBeNull();
  });

  it("同じ時刻（同じ分）は 0 で対象に含む", () => {
    expect(minutesUntilPlan(plan({ time: "09:41" }), now)).toBe(0);
  });
});

describe("nextPlanOf（次の予定の決め方）", () => {
  it("時刻が今以降のいちばん早い予定を返す", () => {
    const early = plan({ id: "early", time: "11:00" });
    const late = plan({ id: "late", time: "18:30" });
    const found = nextPlanOf([late, early], now);
    expect(found?.plan.id).toBe("early");
    expect(found?.remainingMinutes).toBe(79);
  });

  it("取りやめ済みと時刻未定を飛ばす", () => {
    const cancelled = plan({
      id: "cancelled",
      time: "10:00",
      cancelledAt: "2026-10-13T08:00:00.000Z",
      cancelledBy: userId,
    });
    const unset = plan({ id: "unset", time: null });
    const next = plan({ id: "next", time: "12:00" });
    const found = nextPlanOf([cancelled, unset, next], now);
    expect(found?.plan.id).toBe("next");
  });

  it("今日でない日・次の予定が無い日は null", () => {
    expect(nextPlanOf([plan({ date: "2026-10-14" })], now)).toBeNull();
    expect(nextPlanOf([plan({ time: "09:00" })], now)).toBeNull();
    expect(
      nextPlanOf(
        [
          plan({
            cancelledAt: "2026-10-13T08:00:00.000Z",
            cancelledBy: userId,
          }),
        ],
        now,
      ),
    ).toBeNull();
  });

  it("0:00 前後（UTC の 15:00 で日本の日付が変わる）", () => {
    // UTC 2026-10-12 15:30 = 日本時間 2026-10-13 00:30。
    const justAfterMidnight = new Date("2026-10-12T15:30:00.000Z");
    // 日本では今日（10/13）の 0:45 → 15 分後。
    expect(
      minutesUntilPlan(
        plan({ date: "2026-10-13", time: "00:45" }),
        justAfterMidnight,
      ),
    ).toBe(15);
    // UTC では同じ 10/12 でも日本では昨日の予定は対象外。
    expect(
      minutesUntilPlan(
        plan({ date: "2026-10-12", time: "23:59" }),
        justAfterMidnight,
      ),
    ).toBeNull();
    // 日本時間で今日の最初の予定が「次の予定」になる。
    expect(
      nextPlanOf(
        [
          plan({ id: "yesterday", date: "2026-10-12", time: "23:59" }),
          plan({ id: "today", date: "2026-10-13", time: "00:45" }),
        ],
        justAfterMidnight,
      )?.plan.id,
    ).toBe("today");
  });
});

describe("nowLineIndexOf（「今 · 次まで」の線の位置）", () => {
  it("今の時刻の位置＝時刻が今以降のいちばん早い行の直前", () => {
    const plans = [
      plan({ id: "past", time: "09:00" }),
      plan({ id: "next", time: "12:00" }),
      plan({ id: "later", time: "18:30" }),
      plan({ id: "unset", time: null }),
    ];
    expect(nowLineIndexOf(plans, now)).toBe(1);
  });

  it("取りやめ済みの行が今以降にあれば、その直前に線を出す", () => {
    const plans = [
      plan({ id: "past", time: "09:00" }),
      plan({
        id: "cancelled",
        time: "10:00",
        cancelledAt: "2026-10-13T08:00:00.000Z",
        cancelledBy: userId,
      }),
      plan({ id: "next", time: "12:00" }),
    ];
    expect(nowLineIndexOf(plans, now)).toBe(1);
  });

  it("次の予定が無い日は -1（線を出さない）", () => {
    const plans = [
      plan({ id: "past", time: "09:00" }),
      plan({ id: "unset", time: null }),
    ];
    expect(nowLineIndexOf(plans, now)).toBe(-1);
    // 全部が取りやめ済みでも線は出さない。
    expect(
      nowLineIndexOf(
        [
          plan({
            id: "cancelled",
            time: "10:00",
            cancelledAt: "2026-10-13T08:00:00.000Z",
            cancelledBy: userId,
          }),
        ],
        now,
      ),
    ).toBe(-1);
    // 今日でない日も -1。
    expect(
      nowLineIndexOf([plan({ id: "x", date: "2026-10-14" })], now),
    ).toBe(-1);
  });
});
