import type { Clock } from "../../../adapter/clock/clock.js";
import type { UnitOfWork } from "../../../adapter/transaction/unit-of-work.js";
import { Todo } from "../domain/todo.js";
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

/** ToDoの名前・メモの変更。予定の編集と同じく版を確かめる。 */
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
        const patch = {
          ...(input.name === undefined ? {} : { name: parsePlanName(input.name) }),
          ...(input.memo === undefined ? {} : { memo: parsePlanMemo(input.memo) }),
        };
        return runTodoTransaction(
          this.unitOfWork,
          { ...input, operation: UPDATE_TODO_OPERATION },
          (ctx) =>
            runTodoUpdate(
              ctx,
              { ...input, operation: UPDATE_TODO_OPERATION },
              (todo) => Todo.update(todo, patch, this.clock.now()),
            ),
        );
      },
    );
  }
}
