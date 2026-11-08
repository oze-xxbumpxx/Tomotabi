import type { Clock } from "../../../adapter/clock/clock.js";
import type { UnitOfWork } from "../../../adapter/transaction/unit-of-work.js";
import { Todo } from "../domain/todo.js";
import {
  REOPEN_TODO_OPERATION,
  type ReopenTodoInputPort,
  type TodoCommandInput,
  type TodoWriteResult,
} from "../adapter/inbound/todo.input-port.js";
import type { PlanningWorkContext } from "../adapter/outbound/planning-work-context.js";
import type { WriteLog } from "../adapter/outbound/write-log.port.js";
import {
  executeTodoWrite,
  runTodoTransaction,
  runTodoUpdate,
} from "./todo-write-flow.js";

/** 未完了に戻し、予定とのつながりも消す。版は見ない。 */
export class ReopenTodoUseCase implements ReopenTodoInputPort {
  constructor(
    private readonly unitOfWork: UnitOfWork<PlanningWorkContext>,
    private readonly clock: Clock,
    private readonly writeLog: WriteLog,
  ) {}

  execute(input: TodoCommandInput): Promise<TodoWriteResult> {
    const command = { ...input, operation: REOPEN_TODO_OPERATION };
    return executeTodoWrite(
      this.writeLog,
      REOPEN_TODO_OPERATION,
      input.tripId,
      input.todoId,
      () =>
        runTodoTransaction(this.unitOfWork, command, (ctx) =>
          runTodoUpdate(ctx, { ...command, ifMatch: null }, (todo) =>
            Todo.reopen(todo, this.clock.now()),
          ),
        ),
    );
  }
}
