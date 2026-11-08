import { describe, expect, it } from "vitest";
import { BoundedText } from "../../src/common/domain/bounded-text";
import { Todo } from "../../src/modules/planning/domain/todo";
import { ACTOR, PARTNER, testTodo } from "../support/planning-context";

const AT = new Date("2026-09-05T12:00:00.000Z");
const LATER = new Date("2026-09-06T12:00:00.000Z");
const PLAN_ID = "88888888-8888-4888-8888-888888888888";

describe("ToDoのDomain", () => {
  it("名前・メモが同じなら同じToDoを返し、版を増やさない", () => {
    const todo = testTodo();
    expect(Todo.update(todo, { name: todo.name, memo: null }, AT)).toBe(todo);
  });

  it("名前とメモを変えると版が1つ増える", () => {
    const updated = Todo.update(
      testTodo(),
      {
        name: BoundedText.parse("南禅寺の湯豆腐", 100),
        memo: BoundedText.parse("昼は混む", 2000),
      },
      AT,
    );
    expect(updated.name).toBe("南禅寺の湯豆腐");
    expect(updated.memo).toBe("昼は混む");
    expect(updated.version).toBe(2);
    expect(updated.updatedAt).toBe(AT);
  });

  it("メモにnullを渡すと消える", () => {
    const todo = testTodo({ memo: BoundedText.parse("昼は混む", 2000) });
    expect(Todo.update(todo, { memo: null }, AT).memo).toBeNull();
  });

  it("完了にすると、完了した人・時刻・予定が入る", () => {
    const done = Todo.complete(testTodo(), ACTOR, AT, PLAN_ID);
    expect(done).toMatchObject({
      doneAt: AT,
      doneBy: ACTOR,
      planId: PLAN_ID,
      version: 2,
    });
  });

  it("完了済みを完了にしても、最初の人・時刻・予定のまま", () => {
    const done = Todo.complete(testTodo(), ACTOR, AT, null);
    expect(Todo.complete(done, PARTNER, LATER, PLAN_ID)).toBe(done);
  });

  it("未完了に戻すと、完了の人・時刻・予定が消える", () => {
    const done = Todo.complete(testTodo(), ACTOR, AT, PLAN_ID);
    const reopened = Todo.reopen(done, LATER);
    expect(reopened).toMatchObject({
      doneAt: null,
      doneBy: null,
      planId: null,
      version: 3,
    });
  });

  it("未完了を戻しても変わらない", () => {
    const todo = testTodo();
    expect(Todo.reopen(todo, AT)).toBe(todo);
  });
});
