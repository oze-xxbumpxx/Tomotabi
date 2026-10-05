import { describe, expect, it } from "vitest";
import type { PlanKind } from "../../src/modules/planning/domain/plan-kind";
import {
  planEventRejection,
  type PlanEventKind,
} from "../../src/modules/record/domain/plan-event";

const CANCELLED = new Date("2026-09-03T00:00:00.000Z");

// RU-01: 種類ごとに付けられる予定の種類と、取りやめた予定への可否
describe("達成・予約を付けられる予定の決まり（RU-01）", () => {
  it("達成は場所・食べ処・買い物に付けられる", () => {
    const cases: readonly [PlanKind, string | null][] = [
      ["place", null],
      ["food", null],
      ["shopping", null],
      ["lodging", "kind_not_supported"],
      ["transport", "kind_not_supported"],
    ];
    for (const [kind, expected] of cases) {
      expect(
        planEventRejection("achievement", { kind, cancelledAt: null }),
        `${kind}への達成`,
      ).toBe(expected);
    }
  });

  it("予約は食べ処・宿・移動に付けられる", () => {
    const cases: readonly [PlanKind, string | null][] = [
      ["food", null],
      ["lodging", null],
      ["transport", null],
      ["place", "kind_not_supported"],
      ["shopping", "kind_not_supported"],
    ];
    for (const [kind, expected] of cases) {
      expect(
        planEventRejection("booking", { kind, cancelledAt: null }),
        `${kind}への予約`,
      ).toBe(expected);
    }
  });

  it("取りやめた予定には達成は付けられないが予約は付けられる", () => {
    // 取りやめていても種類が合わない達成は種類の理由が先に出る
    const cancelledPlans: readonly [PlanKind, string | null][] = [
      ["place", "plan_cancelled"],
      ["food", "plan_cancelled"],
      ["shopping", "plan_cancelled"],
      ["lodging", "kind_not_supported"],
      ["transport", "kind_not_supported"],
    ];
    for (const [kind, expected] of cancelledPlans) {
      expect(
        planEventRejection("achievement", { kind, cancelledAt: CANCELLED }),
        `取りやめた${kind}への達成`,
      ).toBe(expected);
    }

    const bookingKinds: readonly PlanKind[] = [
      "place",
      "food",
      "shopping",
      "lodging",
      "transport",
    ];
    for (const kind of bookingKinds) {
      // 予約は取りやめの有無で結果が変わらない
      expect(
        planEventRejection("booking", { kind, cancelledAt: CANCELLED }),
        `取りやめた${kind}への予約`,
      ).toBe(
        planEventRejection("booking", { kind, cancelledAt: null }),
      );
    }
  });

  it("URLの種類ごとに判定が分かれる（食べ処は両方、場所は達成だけ）", () => {
    const food = { kind: "food" as PlanKind, cancelledAt: null };
    const place = { kind: "place" as PlanKind, cancelledAt: null };
    const kinds: readonly PlanEventKind[] = ["achievement", "booking"];
    const results = {
      food: kinds.map((kind) => planEventRejection(kind, food)),
      place: kinds.map((kind) => planEventRejection(kind, place)),
    };
    expect(results.food).toEqual([null, null]);
    expect(results.place).toEqual([null, "kind_not_supported"]);
  });
});
