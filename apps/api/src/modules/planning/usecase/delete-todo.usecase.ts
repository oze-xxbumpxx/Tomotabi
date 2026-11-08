import type { TodoDeletion } from "@tomotabi/contracts";
import type { UnitOfWork } from "../../../adapter/transaction/unit-of-work.js";
import {
  DELETE_TODO_OPERATION,
  type DeleteTodoInputPort,
  type TodoCommandInput,
  type TodoWriteResult,
} from "../adapter/inbound/todo.input-port.js";
import type { PlanningWorkContext } from "../adapter/outbound/planning-work-context.js";
import type { WriteLog } from "../adapter/outbound/write-log.port.js";
import {
  executeTodoWrite,
  runTodoTransaction,
  todoNotFound,
} from "./todo-write-flow.js";
import { storedReceipt, tripNotAccessible } from "./trip-write-flow.js";

/**
 * ToDoの削除（元に戻せない）。receiptに`{ id }`を残すので、同じキーの再送は
 * 行がもう無くても同じ200を返す（設計書「API 設計」）。
 */
export class DeleteTodoUseCase implements DeleteTodoInputPort {
  constructor(
    private readonly unitOfWork: UnitOfWork<PlanningWorkContext>,
    private readonly writeLog: WriteLog,
  ) {}

  execute(input: TodoCommandInput): Promise<TodoWriteResult<TodoDeletion>> {
    const command = { ...input, operation: DELETE_TODO_OPERATION };
    return executeTodoWrite(
      this.writeLog,
      DELETE_TODO_OPERATION,
      input.tripId,
      input.todoId,
      () =>
        runTodoTransaction<TodoDeletion>(
          this.unitOfWork,
          command,
          async (ctx) => {
            const trip = await ctx.trips.lockForShare(
              input.tripId,
              input.userId,
            );
            if (trip === null) {
              throw tripNotAccessible();
            }
            const stored = await storedReceipt<TodoDeletion>(
              ctx,
              input.userId,
              DELETE_TODO_OPERATION,
              input.key,
              input.requestHash,
            );
            if (stored !== null) {
              return stored;
            }
            const todo = await ctx.todos.lockForUpdate(
              input.tripId,
              input.todoId,
            );
            if (todo === null) {
              throw todoNotFound();
            }
            await ctx.todos.delete(input.tripId, todo.id);
            const body: TodoDeletion = { id: todo.id };
            await ctx.receipts.insert({
              actorId: input.userId,
              operation: DELETE_TODO_OPERATION,
              idempotencyKey: input.key,
              tripId: trip.id,
              requestHash: input.requestHash,
              resourceType: "todo_deletion",
              resourceId: todo.id,
              httpStatus: 200,
              responseBody: body,
            });
            return { httpStatus: 200, body, replayed: false };
          },
        ),
    );
  }
}
