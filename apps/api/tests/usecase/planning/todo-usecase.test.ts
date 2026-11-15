import { describe, expect, it } from "vitest";
import { ApiError } from "../../../src/common/http/api-error";
import { UserId } from "../../../src/common/domain/user-id";
import { CompleteTodoUseCase } from "../../../src/modules/planning/usecase/complete-todo.usecase";
import { CreatePlanUseCase } from "../../../src/modules/planning/usecase/create-plan.usecase";
import { CreateTodoUseCase } from "../../../src/modules/planning/usecase/create-todo.usecase";
import { DeleteTodoUseCase } from "../../../src/modules/planning/usecase/delete-todo.usecase";
import { ReopenTodoUseCase } from "../../../src/modules/planning/usecase/reopen-todo.usecase";
import { UpdateTodoUseCase } from "../../../src/modules/planning/usecase/update-todo.usecase";
import {
  ACTOR,
  CATEGORY_ID,
  fixedClock,
  InMemoryPlanningContext,
  inMemoryUnitOfWork,
  KEY,
  PARTNER,
  RecordingWriteLog,
  TODO_ID,
  testCategory,
  testPlan,
  testTodo,
  testTrip,
} from "../../support/planning-context";

const TRIP_ID = "99999999-9999-4999-8999-999999999999";
const OUTSIDER = UserId.parse("00000000-0000-4000-8000-000000000009");
const NOW = new Date("2026-09-05T12:00:00.000Z");

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
    todoId: TODO_ID,
    key: KEY,
    requestHash: "hash-t",
    ...overrides,
  } as Parameters<CompleteTodoUseCase["execute"]>[0];
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

describe("ToDoの追加", () => {
  it("201で作り、受領を`todo`で残す", async () => {
    const { ctx, uow, writeLog } = setup();
    const result = await new CreateTodoUseCase(uow, writeLog).execute({
      userId: ACTOR,
      tripId: TRIP_ID,
      key: KEY,
      requestHash: "hash-c",
      name: "  清水寺  ",
    });
    expect(result.httpStatus).toBe(201);
    expect(result.body).toMatchObject({
      name: "清水寺",
      createdBy: ACTOR,
      doneAt: null,
      plan: null,
      version: "1",
    });
    expect([...ctx.receiptRows.values()][0]?.resourceType).toBe("todo");
  });

  it("同じキーで送り直すと同じ本文が返り、行は1件のまま", async () => {
    const { ctx, uow, writeLog } = setup();
    const usecase = new CreateTodoUseCase(uow, writeLog);
    const input = {
      userId: ACTOR,
      tripId: TRIP_ID,
      key: KEY,
      requestHash: "hash-c",
      name: "清水寺",
    };
    const first = await usecase.execute(input);
    const second = await usecase.execute(input);
    expect(second.body).toEqual(first.body);
    expect(ctx.todoRows.size).toBe(1);
    expect(writeLog.entries.map((entry) => entry.result)).toEqual([
      "created",
      "replayed",
    ]);
  });

  it("200件あると422 TODO_LIMIT_REACHED、199件なら追加できる", async () => {
    const { ctx, uow, writeLog } = setup();
    for (let i = 0; i < 199; i += 1) {
      ctx.seedTodo(testTodo({ id: `todo-${i}` }));
    }
    const usecase = new CreateTodoUseCase(uow, writeLog);
    const ok = await usecase.execute({
      userId: ACTOR,
      tripId: TRIP_ID,
      key: KEY,
      requestHash: "hash-1",
      name: "200件目",
    });
    expect(ok.httpStatus).toBe(201);
    const error = await rejection(
      usecase.execute({
        userId: ACTOR,
        tripId: TRIP_ID,
        key: "22222222-2222-4222-8222-222222222222" as typeof KEY,
        requestHash: "hash-2",
        name: "201件目",
      }),
    );
    expect(error.code).toBe("TODO_LIMIT_REACHED");
    expect(error.status).toBe(422);
  });

  it("空白だけの名前は422 VALIDATION_FAILED", async () => {
    const { uow, writeLog } = setup();
    const error = await rejection(
      new CreateTodoUseCase(uow, writeLog).execute({
        userId: ACTOR,
        tripId: TRIP_ID,
        key: KEY,
        requestHash: "hash-c",
        name: "   ",
      }),
    );
    expect(error.code).toBe("VALIDATION_FAILED");
  });

  it("参加していない旅行は403 TRIP_NOT_ACCESSIBLE", async () => {
    const { uow, writeLog } = setup();
    const error = await rejection(
      new CreateTodoUseCase(uow, writeLog).execute({
        userId: OUTSIDER,
        tripId: TRIP_ID,
        key: KEY,
        requestHash: "hash-c",
        name: "清水寺",
      }),
    );
    expect(error.code).toBe("TRIP_NOT_ACCESSIBLE");
    expect(error.status).toBe(403);
  });
});

describe("ToDoの編集", () => {
  it("版が合えば名前とメモを変える", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedTodo(testTodo());
    const result = await new UpdateTodoUseCase(
      uow,
      fixedClock(),
      writeLog,
    ).execute({
      ...command(),
      ifMatch: "1",
      name: "南禅寺の湯豆腐",
      memo: "昼は混む",
    });
    expect(result.body).toMatchObject({
      name: "南禅寺の湯豆腐",
      memo: "昼は混む",
      version: "2",
    });
  });

  it("版が違えば409 VERSION_CONFLICT", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedTodo(testTodo({ version: 2 }));
    const error = await rejection(
      new UpdateTodoUseCase(uow, fixedClock(), writeLog).execute({
        ...command(),
        ifMatch: "1",
        name: "南禅寺の湯豆腐",
        memo: undefined,
      }),
    );
    expect(error.code).toBe("VERSION_CONFLICT");
  });
});

describe("完了の付け外し", () => {
  it("完了は版を見ない。相手が名前を直したあとでも完了にできる", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedTodo(testTodo({ version: 5 }));
    const result = await new CompleteTodoUseCase(
      uow,
      fixedClock(),
      writeLog,
    ).execute(command());
    expect(result.body).toMatchObject({
      doneBy: ACTOR,
      doneAt: NOW.toISOString(),
      plan: null,
    });
  });

  it("完了済みを相手が完了にしても、最初に完了した人のまま", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedTodo(testTodo({ doneAt: NOW, doneBy: ACTOR, version: 2 }));
    const result = await new CompleteTodoUseCase(
      uow,
      fixedClock(),
      writeLog,
    ).execute(command({ userId: PARTNER }));
    expect(result.body.doneBy).toBe(ACTOR);
    expect(result.body.version).toBe("2");
  });

  it("戻すと完了の人・時刻は消えるが、予定とのつながりは残る", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedPlan(testPlan());
    ctx.seedTodo(
      testTodo({
        doneAt: NOW,
        doneBy: ACTOR,
        planId: testPlan().id,
        version: 2,
      }),
    );
    const result = await new ReopenTodoUseCase(
      uow,
      fixedClock(),
      writeLog,
    ).execute(command());
    expect(result.body).toMatchObject({
      doneAt: null,
      doneBy: null,
      plan: { id: testPlan().id, name: "清水寺", cancelled: false },
    });
    expect(ctx.planRows.has(testPlan().id)).toBe(true);
  });

  it("別の旅行のToDoのIDは404 TODO_NOT_FOUND", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedTodo(testTodo({ tripId: "other-trip" }));
    const error = await rejection(
      new CompleteTodoUseCase(uow, fixedClock(), writeLog).execute(command()),
    );
    expect(error.code).toBe("TODO_NOT_FOUND");
    expect(error.status).toBe(404);
  });
});

describe("ToDoの削除", () => {
  it("消して`{ id }`を返し、受領を`todo_deletion`で残す", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedTodo(testTodo());
    const result = await new DeleteTodoUseCase(uow, writeLog).execute(
      command(),
    );
    expect(result).toEqual({ httpStatus: 200, body: { id: TODO_ID } });
    expect(ctx.todoRows.has(TODO_ID)).toBe(false);
    expect([...ctx.receiptRows.values()][0]?.resourceType).toBe(
      "todo_deletion",
    );
  });

  it("同じキーで送り直すと、行が無くても同じ200が返る", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedTodo(testTodo());
    const usecase = new DeleteTodoUseCase(uow, writeLog);
    await usecase.execute(command());
    const again = await usecase.execute(command());
    expect(again).toEqual({ httpStatus: 200, body: { id: TODO_ID } });
  });

  it("相手が先に消していたら、別のキーでは404 TODO_NOT_FOUND", async () => {
    const { uow, writeLog } = setup();
    const error = await rejection(
      new DeleteTodoUseCase(uow, writeLog).execute(command()),
    );
    expect(error.code).toBe("TODO_NOT_FOUND");
  });
});

describe("新しく予定を作る（予定の追加のfromTodoId）", () => {
  function createPlan(
    uow: ReturnType<typeof setup>["uow"],
    writeLog: RecordingWriteLog,
    fromTodoId: string | null,
    userId = ACTOR,
  ) {
    return new CreatePlanUseCase(uow, fixedClock(), writeLog).execute({
      userId,
      tripId: TRIP_ID,
      key: KEY,
      requestHash: "hash-p",
      name: "湯豆腐を食べる",
      kind: "food",
      date: "2026-09-11",
      time: null,
      memo: null,
      fromTodoId,
    });
  }

  it("予定を作ると元のToDoとつなぐが、ToDoは完了にしない（F-19）", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedTodo(testTodo());
    const result = await createPlan(uow, writeLog, TODO_ID, PARTNER);
    expect(ctx.todoRows.get(TODO_ID)).toMatchObject({
      doneAt: null,
      doneBy: null,
      planId: result.body.id,
    });
    expect(ctx.calls.indexOf("plans.insert")).toBeLessThan(
      ctx.calls.indexOf("todos.lockForUpdate"),
    );
  });

  it("元のToDoが消されていても予定は作る", async () => {
    const { uow, writeLog } = setup();
    const result = await createPlan(uow, writeLog, TODO_ID);
    expect(result.httpStatus).toBe(201);
  });

  it("元のToDoが完了済みで予定と結んでいなければ、完了のまま予定とつなぐ", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedTodo(testTodo({ doneAt: NOW, doneBy: PARTNER, version: 2 }));
    const result = await createPlan(uow, writeLog, TODO_ID);
    expect(ctx.todoRows.get(TODO_ID)).toMatchObject({
      doneAt: NOW,
      doneBy: PARTNER,
      planId: result.body.id,
    });
  });

  it("元のToDoに関連する予定がすでにあれば、その予定のまま変えない（E-08）", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedTodo(testTodo({ planId: "existing-plan" }));
    const result = await createPlan(uow, writeLog, TODO_ID);
    expect(result.httpStatus).toBe(201);
    expect(ctx.todoRows.get(TODO_ID)?.planId).toBe("existing-plan");
  });

  it("別の旅行のToDoは変えない", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedTodo(testTodo({ tripId: "other-trip" }));
    await createPlan(uow, writeLog, TODO_ID);
    expect(ctx.todoRows.get(TODO_ID)?.doneAt).toBeNull();
  });

  it("fromTodoIdが無ければToDoに触らない", async () => {
    const { ctx, uow, writeLog } = setup();
    await createPlan(uow, writeLog, null);
    expect(ctx.calls.some((call) => call.startsWith("todos."))).toBe(false);
  });
});

describe("ToDoの決まりの残り", () => {
  it("削除済みのToDoは、編集・完了・戻すのどれも404 TODO_NOT_FOUND（E-04）", async () => {
    const { uow, writeLog } = setup();
    const clock = fixedClock();
    const results = await Promise.all([
      rejection(
        new UpdateTodoUseCase(uow, clock, writeLog).execute({
          ...command(),
          ifMatch: "1",
          name: "x",
          memo: undefined,
        }),
      ),
      rejection(
        new CompleteTodoUseCase(uow, clock, writeLog).execute(command()),
      ),
      rejection(new ReopenTodoUseCase(uow, clock, writeLog).execute(command())),
    ]);
    expect(results.map((error) => error.code)).toEqual([
      "TODO_NOT_FOUND",
      "TODO_NOT_FOUND",
      "TODO_NOT_FOUND",
    ]);
  });

  it("同じキーで違う内容を送ると409 IDEMPOTENCY_KEY_REUSED", async () => {
    const { uow, writeLog } = setup();
    const usecase = new CreateTodoUseCase(uow, writeLog);
    await usecase.execute({
      userId: ACTOR,
      tripId: TRIP_ID,
      key: KEY,
      requestHash: "hash-1",
      name: "清水寺",
    });
    const error = await rejection(
      usecase.execute({
        userId: ACTOR,
        tripId: TRIP_ID,
        key: KEY,
        requestHash: "hash-2",
        name: "金閣寺",
      }),
    );
    expect(error.code).toBe("IDEMPOTENCY_KEY_REUSED");
  });

  it("旅行が終わったあとも追加・完了・削除できる（B-06）", async () => {
    const ctx = new InMemoryPlanningContext();
    const uow = inMemoryUnitOfWork(ctx);
    const writeLog = new RecordingWriteLog();
    ctx.seedTrip(
      testTrip({ status: "finished", finishedAt: NOW, finishedBy: ACTOR }),
      [ACTOR, PARTNER],
    );
    const created = await new CreateTodoUseCase(uow, writeLog).execute({
      userId: ACTOR,
      tripId: TRIP_ID,
      key: KEY,
      requestHash: "hash-c",
      name: "次は嵐山",
    });
    const todoId = created.body.id;
    const done = await new CompleteTodoUseCase(
      uow,
      fixedClock(),
      writeLog,
    ).execute(command({ todoId, key: "22222222-2222-4222-8222-222222222222" }));
    expect(done.body.doneBy).toBe(ACTOR);
    const removed = await new DeleteTodoUseCase(uow, writeLog).execute(
      command({ todoId, key: "33333333-3333-4333-8333-333333333333" }),
    );
    expect(removed.body).toEqual({ id: todoId });
  });

  it("予定を取りやめても、ToDoは完了のままで予定の取りやめが分かる（F-12・F-16）", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedPlan(testPlan({ cancelledAt: NOW, cancelledBy: ACTOR }));
    ctx.seedTodo(
      testTodo({
        doneAt: NOW,
        doneBy: ACTOR,
        planId: testPlan().id,
        version: 2,
      }),
    );
    const result = await new CompleteTodoUseCase(
      uow,
      fixedClock(),
      writeLog,
    ).execute(command());
    expect(result.body).toMatchObject({
      doneBy: ACTOR,
      plan: { id: testPlan().id, cancelled: true },
    });
  });
});

describe("ToDoのカテゴリ・担当・期限", () => {
  it("追加にcategoryIdを付けられる。同じ旅行のカテゴリだけ", async () => {
    const { ctx, uow, writeLog } = setup();
    const usecase = new CreateTodoUseCase(uow, writeLog);
    ctx.seedCategory(testCategory());
    const ok = await usecase.execute({
      userId: ACTOR,
      tripId: TRIP_ID,
      key: KEY,
      requestHash: "hash-c1",
      name: "清水寺",
      categoryId: CATEGORY_ID,
    });
    expect(ok.body.categoryId).toBe(CATEGORY_ID);
    const ng = await rejection(
      usecase.execute({
        userId: ACTOR,
        tripId: TRIP_ID,
        key: "22222222-2222-4222-8222-222222222222" as typeof KEY,
        requestHash: "hash-c2",
        name: "金閣寺",
        categoryId: "44444444-4444-4444-8444-444444444999",
      }),
    );
    expect(ng.code).toBe("TODO_CATEGORY_NOT_FOUND");
    expect(ng.status).toBe(422);
  });

  it("編集でカテゴリ・担当・期限を入れられる", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedCategory(testCategory());
    ctx.seedTodo(testTodo());
    const result = await new UpdateTodoUseCase(
      uow,
      fixedClock(),
      writeLog,
    ).execute({
      ...command(),
      ifMatch: "1",
      name: undefined,
      memo: undefined,
      categoryId: CATEGORY_ID,
      assigneeId: PARTNER,
      dueOn: "2026-09-12",
    });
    expect(result.body).toMatchObject({
      categoryId: CATEGORY_ID,
      assigneeId: PARTNER,
      dueOn: "2026-09-12",
      version: "2",
    });
  });

  it("担当に旅行の参加者以外を入れると422 TODO_ASSIGNEE_NOT_PARTICIPANT", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedTodo(testTodo());
    const error = await rejection(
      new UpdateTodoUseCase(uow, fixedClock(), writeLog).execute({
        ...command(),
        ifMatch: "1",
        name: undefined,
        memo: undefined,
        categoryId: undefined,
        assigneeId: OUTSIDER,
        dueOn: undefined,
      }),
    );
    expect(error.code).toBe("TODO_ASSIGNEE_NOT_PARTICIPANT");
    expect(error.status).toBe(422);
  });

  it("実在しない期限は422 VALIDATION_FAILED", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedTodo(testTodo());
    const error = await rejection(
      new UpdateTodoUseCase(uow, fixedClock(), writeLog).execute({
        ...command(),
        ifMatch: "1",
        name: undefined,
        memo: undefined,
        categoryId: undefined,
        assigneeId: undefined,
        dueOn: "2026-02-30",
      }),
    );
    expect(error.code).toBe("VALIDATION_FAILED");
    expect(error.status).toBe(422);
  });
});

describe("予定との関連付け（planId）", () => {
  const PLAN_ID = "88888888-8888-4888-8888-888888888888";

  it("追加でplanIdを付けると、作ったToDoが予定と結ばれる", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedPlan(testPlan());
    const result = await new CreateTodoUseCase(uow, writeLog).execute({
      userId: ACTOR,
      tripId: TRIP_ID,
      key: KEY,
      requestHash: "hash-c",
      name: "清水寺",
      categoryId: null,
      planId: PLAN_ID,
    });
    expect(result.httpStatus).toBe(201);
    expect(result.body.plan).toMatchObject({ id: PLAN_ID, cancelled: false });
  });

  it("取りやめた・別の旅行の・無い予定は付けられない（422 TODO_PLAN_NOT_AVAILABLE）", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedPlan(
      testPlan({ id: "cancelled-plan", cancelledAt: NOW, cancelledBy: ACTOR }),
    );
    ctx.seedPlan(testPlan({ id: "other-plan", tripId: "other-trip" }));
    const usecase = new CreateTodoUseCase(uow, writeLog);
    for (const planId of ["cancelled-plan", "other-plan", "missing-plan"]) {
      const error = await rejection(
        usecase.execute({
          userId: ACTOR,
          tripId: TRIP_ID,
          key: KEY,
          requestHash: "hash-c",
          name: "清水寺",
          categoryId: null,
          planId,
        }),
      );
      expect(error.code).toBe("TODO_PLAN_NOT_AVAILABLE");
      expect(error.status).toBe(422);
    }
    expect(ctx.todoRows.size).toBe(0);
  });

  it("編集で予定と結び、nullで外せる", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedPlan(testPlan());
    ctx.seedTodo(testTodo());
    const usecase = new UpdateTodoUseCase(uow, fixedClock(), writeLog);
    const linked = await usecase.execute({
      ...command(),
      ifMatch: "1",
      planId: PLAN_ID,
    });
    expect(linked.body.plan).toMatchObject({ id: PLAN_ID });
    const unlinked = await usecase.execute({
      ...command({
        key: "22222222-2222-4222-8222-222222222222" as typeof KEY,
        requestHash: "hash-t2",
      }),
      ifMatch: "2",
      planId: null,
    });
    expect(unlinked.body.plan).toBeNull();
  });

  it("取りやめた予定とは結べない（422）。結んだ予定があとで取りやめになっても、ほかの欄の編集は通る", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedPlan(testPlan({ cancelledAt: NOW, cancelledBy: ACTOR }));
    const usecase = new UpdateTodoUseCase(uow, fixedClock(), writeLog);
    ctx.seedTodo(testTodo());
    const error = await rejection(
      usecase.execute({ ...command(), ifMatch: "1", planId: PLAN_ID }),
    );
    expect(error.code).toBe("TODO_PLAN_NOT_AVAILABLE");
    // すでに結んでいる予定が取りやめでも、名前の編集は通る。
    ctx.seedTodo(testTodo({ planId: PLAN_ID }));
    const renamed = await usecase.execute({
      ...command(),
      ifMatch: "1",
      name: "南禅寺の湯豆腐",
    });
    expect(renamed.body.name).toBe("南禅寺の湯豆腐");
    expect(renamed.body.plan).toMatchObject({ id: PLAN_ID, cancelled: true });
  });
});
