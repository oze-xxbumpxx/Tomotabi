import { describe, expect, it } from "vitest";
import type { Todo, TodoCategory } from "@tomotabi/contracts";
import {
  assignTodos,
  columnCountText,
  dueBadge,
  isDueSoon,
  matchesTodoFilter,
  todoSummary,
} from "@/features/todos";

const tripId = "8a6e0804-2bd0-4672-b79d-d97027f9071a";
const userId = "550e8400-e29b-41d4-a716-446655440000";
const otherUserId = "3f7c1f68-9c05-4f2e-9b4c-2d5b1a90f811";

let seq = 0;
function todo(overrides: Partial<Todo> = {}): Todo {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    tripId,
    name: `ToDo${seq}`,
    memo: null,
    createdBy: userId,
    createdAt: "2026-11-08T03:00:00.000Z",
    doneAt: null,
    doneBy: null,
    plan: null,
    categoryId: null,
    assigneeId: null,
    dueOn: null,
    version: "1",
    ...overrides,
  };
}

function category(id: string, name: string): TodoCategory {
  return { id, tripId, name, version: "1" };
}

describe("期限の印（W-C01・W-C02）", () => {
  it("期限まで3日以内は「あとN日」、当日は「今日まで」、過ぎは「期限切れ」、4日以上先は印なし", () => {
    const today = "2026-10-02";
    expect(dueBadge("2026-10-05", today)).toBe("あと3日");
    expect(dueBadge("2026-10-04", today)).toBe("あと2日");
    expect(dueBadge("2026-10-03", today)).toBe("あと1日");
    expect(dueBadge("2026-10-02", today)).toBe("今日まで");
    expect(dueBadge("2026-10-01", today)).toBe("期限切れ");
    expect(dueBadge("2026-10-06", today)).toBeNull();
    expect(dueBadge(null, today)).toBeNull();
  });

  it("日本の今日は呼び出し側がtokyoDateOfで渡す（日本で0時を過ぎた直後でも当日）", () => {
    // 日本で10/3の0時10分（UTCでは10/2の15:10）。日本の今日は10/3。
    const today = "2026-10-03";
    expect(dueBadge("2026-10-03", today)).toBe("今日まで");
  });
});

describe("絞り込み（W-C03・W-C04）", () => {
  const today = "2026-10-02";
  it("「期限が近い」は未完了で期限切れ・3日以内だけ（完了の期限切れと4日後は除く）", () => {
    const doneOverdue = todo({
      doneAt: "2026-10-01T00:00:00.000Z",
      doneBy: userId,
      dueOn: "2026-10-01",
    });
    const openOverdue = todo({ dueOn: "2026-10-01" });
    const openIn3 = todo({ dueOn: "2026-10-05" });
    const openIn4 = todo({ dueOn: "2026-10-06" });
    const noDue = todo();
    expect(isDueSoon(doneOverdue, today)).toBe(false);
    expect(isDueSoon(openOverdue, today)).toBe(true);
    expect(isDueSoon(openIn3, today)).toBe(true);
    expect(isDueSoon(openIn4, today)).toBe(false);
    expect(isDueSoon(noDue, today)).toBe(false);
    expect(
      [doneOverdue, openOverdue, openIn4, noDue].filter((item) =>
        matchesTodoFilter(item, "due-soon", userId, today),
      ),
    ).toEqual([openOverdue]);
  });

  it("「自分の担当」はassigneeIdが自分のものだけ", () => {
    const mine = todo({ assigneeId: userId });
    const theirs = todo({ assigneeId: otherUserId });
    const undecided = todo({ assigneeId: null });
    expect(
      [mine, theirs, undecided].filter((item) =>
        matchesTodoFilter(item, "mine", userId, today),
      ),
    ).toEqual([mine]);
  });
});

describe("欄への振り分け（W-C05）", () => {
  it("カテゴリの順、最後に未分類。欄の中は未完了が上、完了が下、それぞれ追加した順", () => {
    const catA = category("a", "洗濯物");
    const catB = category("b", "予約");
    const aDone = todo({ categoryId: "a", doneAt: "2026-10-01T00:00:00.000Z", doneBy: userId });
    const aOpen1 = todo({ categoryId: "a" });
    const aOpen2 = todo({ categoryId: "a" });
    const bOpen = todo({ categoryId: "b" });
    const uncat = todo();
    const uncatDone = todo({ doneAt: "2026-10-01T00:00:00.000Z", doneBy: userId });
    const columns = assignTodos(
      [catA, catB],
      [aDone, uncatDone, aOpen1, bOpen, uncat, aOpen2],
    );
    expect(columns.map((c) => c.category?.id ?? null)).toEqual([
      "a",
      "b",
      null,
    ]);
    expect(columns[0]!.open).toEqual([aOpen1, aOpen2]);
    expect(columns[0]!.done).toEqual([aDone]);
    expect(columns[1]!.open).toEqual([bOpen]);
    expect(columns[2]!.open).toEqual([uncat]);
    expect(columns[2]!.done).toEqual([uncatDone]);
  });

  it("一覧に無いカテゴリのToDoは未分類に入れる", () => {
    const catA = category("a", "洗濯物");
    const orphan = todo({ categoryId: "gone" });
    const columns = assignTodos([catA], [orphan]);
    expect(columns[1]!.open).toEqual([orphan]);
  });
});

describe("件数（W-C06）", () => {
  it("全体は「4件済み · 残り6件」、欄は「1 / 3 件済み」", () => {
    const items = [
      ...Array.from({ length: 6 }, () => todo()),
      ...Array.from({ length: 4 }, () =>
        todo({ doneAt: "2026-10-01T00:00:00.000Z", doneBy: userId }),
      ),
    ];
    expect(todoSummary(items)).toMatchObject({
      done: 4,
      open: 6,
      text: "4件済み · 残り6件",
    });
    const column = assignTodos(
      [category("a", "洗濯物")],
      [
        todo({ categoryId: "a" }),
        todo({ categoryId: "a" }),
        todo({
          categoryId: "a",
          doneAt: "2026-10-01T00:00:00.000Z",
          doneBy: userId,
        }),
      ],
    )[0]!;
    expect(columnCountText(column)).toBe("1 / 3 件済み");
  });
});
