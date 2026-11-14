import type { Clock } from "../../../adapter/clock/clock.js";
import type { UnitOfWork } from "../../../adapter/transaction/unit-of-work.js";
import { ApiError } from "../../../common/http/api-error.js";
import { LocalDate } from "../../../common/domain/local-date.js";
import { UserId } from "../../../common/domain/user-id.js";
import { Todo, type TodoPatch } from "../domain/todo.js";
import {
  UPDATE_TODO_OPERATION,
  type TodoWriteResult,
  type UpdateTodoInput,
  type UpdateTodoInputPort,
} from "../adapter/inbound/todo.input-port.js";
import type { PlanningWorkContext } from "../adapter/outbound/planning-work-context.js";
import type { WriteLog } from "../adapter/outbound/write-log.port.js";
import { parsePlanMemo, parsePlanName } from "./plan-input.js";
import {
  executeTodoWrite,
  runTodoTransaction,
  runTodoUpdate,
} from "./todo-write-flow.js";

/**
 * `YYYY-MM-DD`の実在の日付にする。実在しない日付・形式違いは
 * 422 VALIDATION_FAILED（todo-organize「API 設計」の期限の規則）。
 */
function parseTodoDueOn(value: string | null): LocalDate | null {
  if (value === null) {
    return null;
  }
  try {
    return LocalDate.parse(value);
  } catch {
    throw new ApiError({
      code: "VALIDATION_FAILED",
      status: 422,
      message: "dueOn must be a real calendar date in YYYY-MM-DD",
    });
  }
}

/** ToDoの名前・メモ・カテゴリ・担当・期限の変更。予定の編集と同じく版を確かめる。 */
export class UpdateTodoUseCase implements UpdateTodoInputPort {
  constructor(
    private readonly unitOfWork: UnitOfWork<PlanningWorkContext>,
    private readonly clock: Clock,
    private readonly writeLog: WriteLog,
  ) {}

  execute(input: UpdateTodoInput): Promise<TodoWriteResult> {
    return executeTodoWrite(
      this.writeLog,
      UPDATE_TODO_OPERATION,
      input.tripId,
      input.todoId,
      async () => {
        const patch: TodoPatch = {
          ...(input.name === undefined
            ? {}
            : { name: parsePlanName(input.name) }),
          ...(input.memo === undefined
            ? {}
            : { memo: parsePlanMemo(input.memo) }),
          ...(input.categoryId === undefined
            ? {}
            : { categoryId: input.categoryId }),
          ...(input.assigneeId === undefined
            ? {}
            : {
                assigneeId:
                  input.assigneeId === null
                    ? null
                    : UserId.parse(input.assigneeId),
              }),
          ...(input.dueOn === undefined
            ? {}
            : { dueOn: parseTodoDueOn(input.dueOn) }),
        };
        return runTodoTransaction(
          this.unitOfWork,
          { ...input, operation: UPDATE_TODO_OPERATION },
          (ctx) =>
            runTodoUpdate(
              ctx,
              { ...input, operation: UPDATE_TODO_OPERATION },
              (todo) => Todo.update(todo, patch, this.clock.now()),
              async (lockedCtx) => {
                // 付ける欄は同じトランザクションで確かめる。カテゴリは
                // FOR SHARE（ロックの順は旅行 → カテゴリ → ToDo）。
                if (
                  patch.categoryId !== undefined &&
                  patch.categoryId !== null
                ) {
                  const category =
                    await lockedCtx.todoCategories.lockForShare(
                      input.tripId,
                      patch.categoryId,
                    );
                  if (category === null) {
                    throw new ApiError({
                      code: "TODO_CATEGORY_NOT_FOUND",
                      status: 422,
                      message: "Todo category not found in the trip",
                    });
                  }
                }
                if (
                  patch.assigneeId !== undefined &&
                  patch.assigneeId !== null
                ) {
                  // 旅行の参加者だけ担当にできる。旅行行の確かめは
                  // 参加者表を見るのでそのまま使い回せる。
                  const member = await lockedCtx.trips.lockForShare(
                    input.tripId,
                    patch.assigneeId,
                  );
                  if (member === null) {
                    throw new ApiError({
                      code: "TODO_ASSIGNEE_NOT_PARTICIPANT",
                      status: 422,
                      message: "Assignee must be a participant of the trip",
                    });
                  }
                }
              },
            ),
        );
      },
    );
  }
}
