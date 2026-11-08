import type { Clock } from "../../../adapter/clock/clock.js";
import type { UnitOfWork } from "../../../adapter/transaction/unit-of-work.js";
import { Todo } from "../domain/todo.js";
import {
  COMPLETE_TODO_OPERATION,
  type CompleteTodoInputPort,
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

/** 完了の印を付ける。版は見ない（相手が名前を直しても競合にしない）。 */
export class CompleteTodoUseCase implements CompleteTodoInputPort {
  constructor(
    private readonly unitOfWork: UnitOfWork<PlanningWorkContext>,
    private readonly clock: Clock,
    private readonly writeLog: WriteLog,
  ) {}

  execute(input: TodoCommandInput): Promise<TodoWriteResult> {
    const command = { ...input, operation: COMPLETE_TODO_OPERATION };
    return executeTodoWrite(
      this.writeLog,
      COMPLETE_TODO_OPERATION,
      input.tripId,
      input.todoId,
      () =>
        runTodoTransaction(this.unitOfWork, command, (ctx) =>
          runTodoUpdate(ctx, { ...command, ifMatch: null }, (todo) =>
            Todo.complete(todo, input.userId, this.clock.now(), null),
          ),
        ),
    );
  }
}
