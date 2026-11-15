import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../../../src/common/http/api-error";
import { UserId } from "../../../src/common/domain/user-id";
import { CreateTodoCategoryUseCase } from "../../../src/modules/planning/usecase/create-todo-category.usecase";
import { DeleteTodoCategoryUseCase } from "../../../src/modules/planning/usecase/delete-todo-category.usecase";
import { ReorderTodoCategoriesUseCase } from "../../../src/modules/planning/usecase/reorder-todo-categories.usecase";
import { UpdateTodoCategoryUseCase } from "../../../src/modules/planning/usecase/update-todo-category.usecase";
import {
  ACTOR,
  CATEGORY_ID,
  fixedClock,
  InMemoryPlanningContext,
  inMemoryUnitOfWork,
  KEY,
  PARTNER,
  RecordingWriteLog,
  testCategory,
  testTodo,
  testTrip,
} from "../../support/planning-context";

const TRIP_ID = "99999999-9999-4999-8999-999999999999";
const OUTSIDER = UserId.parse("00000000-0000-4000-8000-000000000009");

function setup() {
  const ctx = new InMemoryPlanningContext();
  const uow = inMemoryUnitOfWork(ctx);
  const writeLog = new RecordingWriteLog();
  ctx.seedTrip(testTrip(), [ACTOR, PARTNER]);
  return { ctx, uow, writeLog };
}

function command(overrides: Record<string, unknown> = {}) {
  return {
    userId: ACTOR,
    tripId: TRIP_ID,
    categoryId: CATEGORY_ID,
    key: KEY,
    requestHash: "hash",
    ...overrides,
  };
}

async function rejection(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected ApiError");
}

describe("カテゴリの追加", () => {
  it("201で作り、受領を`todo_category`で残す", async () => {
    const { ctx, uow, writeLog } = setup();
    const result = await new CreateTodoCategoryUseCase(uow, writeLog).execute({
      userId: ACTOR,
      tripId: TRIP_ID,
      key: KEY,
      requestHash: "hash-cc",
      name: "  持ちもの  ",
    });
    expect(result.httpStatus).toBe(201);
    expect(result.body).toMatchObject({
      tripId: TRIP_ID,
      name: "持ちもの",
      version: "1",
    });
    expect([...ctx.receiptRows.values()][0]?.resourceType).toBe(
      "todo_category",
    );
    expect([...ctx.categoryRows.values()][0]?.position).toBe(0);
  });

  it("同じキーで送り直すと同じ本文が返り、行は1件のまま", async () => {
    const { ctx, uow, writeLog } = setup();
    const usecase = new CreateTodoCategoryUseCase(uow, writeLog);
    const input = {
      userId: ACTOR,
      tripId: TRIP_ID,
      key: KEY,
      requestHash: "hash-cc",
      name: "持ちもの",
    };
    const first = await usecase.execute(input);
    const second = await usecase.execute(input);
    expect(second.body).toEqual(first.body);
    expect(ctx.categoryRows.size).toBe(1);
    expect(writeLog.entries.map((entry) => entry.result)).toEqual([
      "created",
      "replayed",
    ]);
  });

  it("2つ目は先のposition+1、20個あると422 TODO_CATEGORY_LIMIT_REACHED", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedCategory(testCategory({ position: 3 }));
    const usecase = new CreateTodoCategoryUseCase(uow, writeLog);
    const second = await usecase.execute({
      userId: ACTOR,
      tripId: TRIP_ID,
      key: KEY,
      requestHash: "hash-cc2",
      name: "予約するもの",
    });
    expect(second.httpStatus).toBe(201);
    expect([...ctx.categoryRows.values()][1]?.position).toBe(4);
    for (let i = 0; i < 18; i += 1) {
      ctx.seedCategory(testCategory({ id: `cat-${i}`, position: i + 10 }));
    }
    const error = await rejection(
      usecase.execute({
        userId: ACTOR,
        tripId: TRIP_ID,
        key: "33333333-3333-4333-8333-333333333333" as typeof KEY,
        requestHash: "hash-cc3",
        name: "21個目",
      }),
    );
    expect(error.code).toBe("TODO_CATEGORY_LIMIT_REACHED");
    expect(error.status).toBe(422);
  });

  it("空白だけ・31文字の名前は422 VALIDATION_FAILED", async () => {
    const { uow, writeLog } = setup();
    const usecase = new CreateTodoCategoryUseCase(uow, writeLog);
    for (const name of ["   ", "あ".repeat(31)]) {
      const error = await rejection(
        usecase.execute({
          userId: ACTOR,
          tripId: TRIP_ID,
          key: KEY,
          requestHash: "hash-cc",
          name,
        }),
      );
      expect(error.code).toBe("VALIDATION_FAILED");
    }
  });

  it("参加していない旅行は403 TRIP_NOT_ACCESSIBLE", async () => {
    const { uow, writeLog } = setup();
    const error = await rejection(
      new CreateTodoCategoryUseCase(uow, writeLog).execute({
        userId: OUTSIDER,
        tripId: TRIP_ID,
        key: KEY,
        requestHash: "hash-cc",
        name: "持ちもの",
      }),
    );
    expect(error.code).toBe("TRIP_NOT_ACCESSIBLE");
  });
});

describe("カテゴリの名前の変更", () => {
  it("版が合えば名前を変える", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedCategory(testCategory());
    const result = await new UpdateTodoCategoryUseCase(
      uow,
      fixedClock(),
      writeLog,
    ).execute({ ...command(), ifMatch: "1", name: "予約するもの" });
    expect(result.body).toMatchObject({ name: "予約するもの", version: "2" });
  });

  it("版が違えば409 VERSION_CONFLICT、無ければ404 TODO_CATEGORY_NOT_FOUND", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedCategory(testCategory({ version: 2 }));
    const usecase = new UpdateTodoCategoryUseCase(uow, fixedClock(), writeLog);
    const conflict = await rejection(
      usecase.execute({ ...command(), ifMatch: "1", name: "x" }),
    );
    expect(conflict.code).toBe("VERSION_CONFLICT");
    const missing = await rejection(
      usecase.execute({
        ...command({ categoryId: "44444444-4444-4444-8444-444444444999" }),
        ifMatch: "1",
        name: "x",
      }),
    );
    expect(missing.code).toBe("TODO_CATEGORY_NOT_FOUND");
    expect(missing.status).toBe(404);
  });
});

describe("カテゴリの並べ替え", () => {
  function seed3(ctx: InMemoryPlanningContext): string[] {
    const ids = [CATEGORY_ID, "cat-b", "cat-c"];
    ids.forEach((id, index) => {
      ctx.seedCategory(testCategory({ id, position: index }));
    });
    return ids;
  }

  it("fromが今の順と同じなら、新しい順で返し保存する", async () => {
    const { ctx, uow, writeLog } = setup();
    const ids = seed3(ctx);
    const result = await new ReorderTodoCategoriesUseCase(
      uow,
      writeLog,
    ).execute({ ...command(), from: ids, to: [ids[2], ids[0], ids[1]] });
    expect(result.httpStatus).toBe(200);
    expect(result.body.categories.map((c) => c.id)).toEqual([
      ids[2],
      ids[0],
      ids[1],
    ]);
    expect(ids.map((id) => ctx.categoryRows.get(id)?.position)).toEqual([
      1, 2, 0,
    ]);
    expect([...ctx.receiptRows.values()][0]?.resourceType).toBe(
      "todo_category_order",
    );
  });

  it("fromが今の順と違えば409 TODO_CATEGORY_ORDER_CHANGED", async () => {
    const { ctx, uow, writeLog } = setup();
    const ids = seed3(ctx);
    const error = await rejection(
      new ReorderTodoCategoriesUseCase(uow, writeLog).execute({
        ...command(),
        from: [ids[1], ids[0], ids[2]],
        to: [ids[1], ids[0], ids[2]],
      }),
    );
    expect(error.code).toBe("TODO_CATEGORY_ORDER_CHANGED");
    expect(error.status).toBe(409);
  });

  it("ロックが古い順を返しても、読み直した今の順と比べて409にする（A-I07）", async () => {
    const { ctx, uow, writeLog } = setup();
    const ids = seed3(ctx);
    const stale = await ctx.todoCategories.listByTrip(TRIP_ID);
    // 相手が先に並べ替えた。ロックは待つ前に並べた古い順を返す。
    ctx.categoryRows.set(ids[0]!, {
      ...ctx.categoryRows.get(ids[0]!)!,
      position: 2,
    });
    ctx.categoryRows.set(ids[2]!, {
      ...ctx.categoryRows.get(ids[2]!)!,
      position: 0,
    });
    vi.spyOn(ctx.todoCategories, "lockAllForUpdate").mockResolvedValue(stale);
    const error = await rejection(
      new ReorderTodoCategoriesUseCase(uow, writeLog).execute({
        ...command(),
        from: ids,
        to: [ids[1], ids[0], ids[2]],
      }),
    );
    expect(error.code).toBe("TODO_CATEGORY_ORDER_CHANGED");
    expect(ids.map((id) => ctx.categoryRows.get(id)?.position)).toEqual([
      2, 1, 0,
    ]);
  });

  it("toがfromの並べ替えでなければ422 VALIDATION_FAILED", async () => {
    const { ctx, uow, writeLog } = setup();
    const ids = seed3(ctx);
    const error = await rejection(
      new ReorderTodoCategoriesUseCase(uow, writeLog).execute({
        ...command(),
        from: ids,
        to: [ids[0], ids[1], "cat-x"],
      }),
    );
    expect(error.code).toBe("VALIDATION_FAILED");
  });
});

describe("カテゴリの削除", () => {
  it("中のToDoを消してからカテゴリを消し、消えた件数を返す", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedCategory(testCategory());
    ctx.seedTodo(testTodo({ id: "t-1", categoryId: CATEGORY_ID }));
    ctx.seedTodo(testTodo({ id: "t-2", categoryId: CATEGORY_ID }));
    ctx.seedTodo(testTodo({ id: "t-3" }));
    const result = await new DeleteTodoCategoryUseCase(uow, writeLog).execute(
      command({ expectedTodoCount: 2 }),
    );
    expect(result.body).toEqual({ id: CATEGORY_ID, deletedTodoCount: 2 });
    expect(ctx.categoryRows.has(CATEGORY_ID)).toBe(false);
    expect(ctx.todoRows.has("t-3")).toBe(true);
    expect(ctx.todoRows.size).toBe(1);
    expect([...ctx.receiptRows.values()][0]?.resourceType).toBe(
      "todo_category_deletion",
    );
  });

  it("件数が違えば409 TODO_COUNT_CHANGEDで何も消さない", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedCategory(testCategory());
    ctx.seedTodo(testTodo({ id: "t-1", categoryId: CATEGORY_ID }));
    const error = await rejection(
      new DeleteTodoCategoryUseCase(uow, writeLog).execute(
        command({ expectedTodoCount: 0 }),
      ),
    );
    expect(error.code).toBe("TODO_COUNT_CHANGED");
    expect(ctx.categoryRows.has(CATEGORY_ID)).toBe(true);
    expect(ctx.todoRows.has("t-1")).toBe(true);
  });

  it("同じキーで送り直すと、行が無くても同じ200が返る", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedCategory(testCategory());
    const usecase = new DeleteTodoCategoryUseCase(uow, writeLog);
    await usecase.execute(command({ expectedTodoCount: 0 }));
    const again = await usecase.execute(command({ expectedTodoCount: 0 }));
    expect(again.body).toEqual({ id: CATEGORY_ID, deletedTodoCount: 0 });
  });

  it("別のキーでは消えたあと404 TODO_CATEGORY_NOT_FOUND", async () => {
    const { uow, writeLog } = setup();
    const error = await rejection(
      new DeleteTodoCategoryUseCase(uow, writeLog).execute(
        command({ expectedTodoCount: 0 }),
      ),
    );
    expect(error.code).toBe("TODO_CATEGORY_NOT_FOUND");
  });
});

describe("ログに名前を書かない", () => {
  it("カテゴリの操作のログはidだけで、名前を含まない", async () => {
    const { uow, writeLog } = setup();
    await new CreateTodoCategoryUseCase(uow, writeLog).execute({
      userId: ACTOR,
      tripId: TRIP_ID,
      key: KEY,
      requestHash: "hash-cc",
      name: "ひみつの名前",
    });
    expect(writeLog.entries).toHaveLength(1);
    expect(JSON.stringify(writeLog.entries[0])).not.toContain("ひみつ");
    expect(writeLog.entries[0]?.operation).toBe("createTodoCategory");
  });
});
