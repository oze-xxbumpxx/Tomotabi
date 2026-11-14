import type { Todo as TodoContract } from "@tomotabi/contracts";
import { ApiError } from "../../../common/http/api-error.js";
import type { UserId } from "../../../common/domain/user-id.js";
import type { IdempotencyKey } from "../../../common/http/idempotency-key.js";
import type { Todo } from "../domain/todo.js";
import type { TodoWriteResult } from "../adapter/inbound/todo.input-port.js";
import type { PlanningWorkContext } from "../adapter/outbound/planning-work-context.js";
import type { WriteLog } from "../adapter/outbound/write-log.port.js";
import type { UnitOfWork } from "../../../adapter/transaction/unit-of-work.js";
import { toTodoDto } from "./todo-dto.js";
import {
  isUniqueViolation,
  storedReceipt,
  tripNotAccessible,
  type WriteOutcome,
} from "./trip-write-flow.js";

/** 一つの旅行に置けるToDoの数（要件B-04）。 */
export const TODO_LIMIT = 200;

/**
 * 参加している旅行の中で、ToDoが無い・別の旅行のToDoはどちらも同じ404
 * （存在を漏らさない）。
 */
export function todoNotFound(): ApiError {
  return new ApiError({
    code: "TODO_NOT_FOUND",
    status: 404,
    message: "ToDo was not found in the trip",
  });
}

export type TodoWriteCommand = Readonly<{
  userId: UserId;
  tripId: string;
  todoId: string;
  operation: string;
  key: IdempotencyKey;
  requestHash: string;
  /** 名前・メモの編集だけが版を見る。完了の付け外しはnull（設計書「API 設計」）。 */
  ifMatch: string | null;
}>;

/** ToDoをDTOにする。つないだ予定があれば日付と取りやめを読む。 */
export async function todoBody(
  ctx: PlanningWorkContext,
  todo: Todo,
): Promise<TodoContract> {
  const plan =
    todo.planId === null
      ? null
      : await ctx.todos.planLink(todo.tripId, todo.planId);
  return toTodoDto(todo, plan);
}

/**
 * ToDoの書き込みの共通の流れ（予定の`runPlanUpdate`と同じ形）:
 * 旅行行FOR SHARE → receipt → 付ける欄の確かめ → ToDo行FOR NO KEY UPDATE →
 * 版の確認 → Domain → 更新とreceiptを同じトランザクションで保存。
 * ロックは旅行 → カテゴリ → ToDoの順（設計書 todo-organize）。
 * `precheck`はカテゴリ・担当の確かめのようにreceiptのあと・ToDo行のロックの
 * 前に行う確認（同じトランザクションで確かめる）。
 */
export async function runTodoUpdate(
  ctx: PlanningWorkContext,
  command: TodoWriteCommand,
  change: (todo: Todo) => Todo,
  precheck?: (ctx: PlanningWorkContext) => Promise<void>,
): Promise<WriteOutcome<TodoContract>> {
  const trip = await ctx.trips.lockForShare(command.tripId, command.userId);
  if (trip === null) {
    throw tripNotAccessible();
  }
  const replayed = await storedReceipt<TodoContract>(
    ctx,
    command.userId,
    command.operation,
    command.key,
    command.requestHash,
  );
  if (replayed !== null) {
    return replayed;
  }
  if (precheck !== undefined) {
    await precheck(ctx);
  }
  const todo = await ctx.todos.lockForUpdate(command.tripId, command.todoId);
  if (todo === null) {
    throw todoNotFound();
  }
  if (command.ifMatch !== null && String(todo.version) !== command.ifMatch) {
    throw new ApiError({
      code: "VERSION_CONFLICT",
      status: 409,
      message: "ToDo was already updated. Fetch it again and retry",
    });
  }
  const updated = change(todo);
  if (updated !== todo) {
    await ctx.todos.update(updated);
  }
  const body = await todoBody(ctx, updated);
  await ctx.receipts.insert({
    actorId: command.userId,
    operation: command.operation,
    idempotencyKey: command.key,
    tripId: trip.id,
    requestHash: command.requestHash,
    resourceType: "todo",
    resourceId: todo.id,
    httpStatus: 200,
    responseBody: body,
  });
  return { httpStatus: 200, body, replayed: false };
}

/**
 * ToDoの書き込み1件のログ。予定と同じく結果はcreated / replayed / rejected(code)。
 * 利用者の入力（名前・メモ）は含めない。
 */
export async function executeTodoWrite<T extends { id: string }>(
  writeLog: WriteLog,
  operation: string,
  tripId: string,
  todoId: string | null,
  work: () => Promise<WriteOutcome<T>>,
): Promise<TodoWriteResult<T>> {
  const startedAt = Date.now();
  try {
    const outcome = await work();
    writeLog.info({
      operation,
      tripId,
      resourceId: outcome.body.id,
      result: outcome.replayed ? "replayed" : "created",
      errorCode: null,
      durationMs: Date.now() - startedAt,
    });
    return { httpStatus: outcome.httpStatus, body: outcome.body };
  } catch (error) {
    if (error instanceof ApiError) {
      writeLog.info({
        operation,
        tripId,
        resourceId: todoId,
        result: "rejected",
        errorCode: error.code,
        durationMs: Date.now() - startedAt,
      });
    }
    throw error;
  }
}

/**
 * 1トランザクションで書き込む。同じキーの同時の送信はreceiptのPK違反で
 * 負ける側が分かるので、勝った側がCOMMITしたreceiptを読み直して返す
 * （予定の追加と同じ仕組み）。
 */
export async function runTodoTransaction<T>(
  unitOfWork: UnitOfWork<PlanningWorkContext>,
  command: Readonly<{
    userId: UserId;
    operation: string;
    key: IdempotencyKey;
    requestHash: string;
  }>,
  work: (ctx: PlanningWorkContext) => Promise<WriteOutcome<T>>,
): Promise<WriteOutcome<T>> {
  try {
    return await unitOfWork.run(work);
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }
    return unitOfWork.run(async (ctx) => {
      const stored = await storedReceipt<T>(
        ctx,
        command.userId,
        command.operation,
        command.key,
        command.requestHash,
      );
      if (stored === null) {
        throw error;
      }
      return stored;
    });
  }
}
