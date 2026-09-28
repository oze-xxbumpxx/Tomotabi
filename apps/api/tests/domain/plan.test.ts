import { describe, expect, it } from "vitest";
import { BoundedText } from "../../src/common/domain/bounded-text";
import { LocalDate } from "../../src/common/domain/local-date";
import { LocalTime } from "../../src/common/domain/local-time";
import { UserId } from "../../src/common/domain/user-id";
import {
  Plan,
  PlanCancelledError,
  PlanHasRecordHistoryError,
} from "../../src/modules/planning/domain/plan";

const ACTOR = UserId.parse("00000000-0000-4000-8000-000000000001");
const NOW = new Date("2026-09-05T12:00:00.000Z");

function plan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: "88888888-8888-4888-8888-888888888888",
    tripId: "99999999-9999-4999-8999-999999999999",
    name: BoundedText.parse("清水寺", 100),
    kind: "place",
    date: LocalDate.parse("2026-09-11"),
    time: null,
    memo: null,
    cancelledAt: null,
    cancelledBy: null,
    version: 1,
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    updatedAt: new Date("2026-09-01T00:00:00.000Z"),
    ...overrides,
  };
}

// U-09: 部分更新の差分（実質同じ値なら version を増やさない。F-12）
describe("Plan.update（部分更新）", () => {
  it("すべて同じ値なら同じ Plan を返し version は増えない", () => {
    const before = plan({
      time: LocalTime.parse("10:30"),
      memo: BoundedText.parse("拝観料 500 円", 2000),
      version: 3,
    });
    const after = Plan.update(
      before,
      {
        name: before.name,
        kind: before.kind,
        time: before.time,
        memo: before.memo,
      },
      true,
      NOW,
    );
    expect(after).toBe(before);
  });

  it("差分のある欄だけ更新し version を 1 増やす", () => {
    const before = plan({ version: 2 });
    const after = Plan.update(
      before,
      { memo: BoundedText.parse("メモ", 2000) },
      false,
      NOW,
    );
    expect(after).not.toBe(before);
    expect(after.memo).toBe("メモ");
    expect(after.name).toBe("清水寺");
    expect(after.version).toBe(3);
    expect(after.updatedAt).toBe(NOW);
  });

  it("time / memo に null を送ると未定・なしに戻せる", () => {
    const after = Plan.update(
      plan({
        time: LocalTime.parse("10:30"),
        memo: BoundedText.parse("メモ", 2000),
      }),
      { time: null, memo: null },
      false,
      NOW,
    );
    expect(after.time).toBeNull();
    expect(after.memo).toBeNull();
    expect(after.version).toBe(2);
  });

  it("キーが無い欄は触れない（空の差分は同じ Plan を返す）", () => {
    const before = plan({ name: BoundedText.parse("清水寺", 100) });
    const after = Plan.update(before, {}, false, NOW);
    expect(after).toBe(before);
  });
});

// U-10: 種類変更は履歴の有無を引数で受ける（F-15、E-19）
describe("Plan.update（種類変更と履歴）", () => {
  it("履歴なしなら種類を変えられる", () => {
    const after = Plan.update(plan(), { kind: "food" }, false, NOW);
    expect(after.kind).toBe("food");
    expect(after.version).toBe(2);
  });

  it("履歴ありで種類を変えると PlanHasRecordHistoryError", () => {
    expect(() =>
      Plan.update(plan(), { kind: "food" }, true, NOW),
    ).toThrow(PlanHasRecordHistoryError);
  });

  it("履歴があっても同じ種類への「変更」は差分なしで許される", () => {
    const before = plan({ kind: "place" });
    const after = Plan.update(before, { kind: "place" }, true, NOW);
    expect(after).toBe(before);
  });
});

// U-11: 取りやめは一度だけ・編集で解除しない（F-14）
describe("Plan.cancel / 取りやめ後の編集", () => {
  it("cancel は cancelledAt / cancelledBy を記録し version を増やす", () => {
    const after = Plan.cancel(plan(), NOW, ACTOR);
    expect(after.cancelledAt).toBe(NOW);
    expect(after.cancelledBy).toBe(ACTOR);
    expect(after.version).toBe(2);
  });

  it("取りやめ済みにもう一度 cancel すると PlanCancelledError", () => {
    const cancelled = Plan.cancel(plan(), NOW, ACTOR);
    expect(() => Plan.cancel(cancelled, NOW, ACTOR)).toThrow(
      PlanCancelledError,
    );
  });

  it("取りやめ済みを編集しても取りやめは解除されない", () => {
    const cancelled = Plan.cancel(plan(), NOW, ACTOR);
    const edited = Plan.update(
      cancelled,
      { name: BoundedText.parse("伏見稲荷", 100) },
      false,
      NOW,
    );
    expect(edited.name).toBe("伏見稲荷");
    expect(edited.cancelledAt).toBe(NOW);
    expect(edited.cancelledBy).toBe(ACTOR);
    expect(edited.version).toBe(3);
  });
});

describe("Plan.move", () => {
  it("期間内の別の日へ移すと date が変わり version を増やす", () => {
    const after = Plan.move(plan(), LocalDate.parse("2026-09-12"), NOW);
    expect(after.date).toBe("2026-09-12");
    expect(after.version).toBe(2);
  });

  it("同じ日への移動は差分なし", () => {
    const before = plan();
    expect(Plan.move(before, before.date, NOW)).toBe(before);
  });
});
