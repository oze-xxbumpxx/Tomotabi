import type { UnitOfWork } from "../../../adapter/transaction/unit-of-work.js";
import { ApiError } from "../../../common/http/api-error.js";
import {
  DELETE_TODO_CATEGORY_OPERATION,
  type DeleteTodoCategoryInput,
  type DeleteTodoCategoryInputPort,
} from "../adapter/inbound/todo-category.input-port.js";
import type { TodoWriteResult } from "../adapter/inbound/todo.input-port.js";
import type { PlanningWorkContext } from "../adapter/outbound/planning-work-context.js";
import type { WriteLog } from "../adapter/outbound/write-log.port.js";
import {
  executeTodoCategoryWrite,
  todoCategoryNotFound,
} from "./todo-category-write-flow.js";
import { runTodoTransaction } from "./todo-write-flow.js";
import { storedReceipt, tripNotAccessible } from "./trip-write-flow.js";
import type { TodoCategoryDeletion } from "@tomotabi/contracts";

/**
 * カテゴリの削除。中のToDoの件数を保存のときにも数え、送られた
 * `expectedTodoCount`と違えば止める（要件E-04）。同じなら中のToDoを
 * 消してからカテゴリを消す。
 */
export class DeleteTodoCategoryUseCase implements DeleteTodoCategoryInputPort {
  constructor(
    private readonly unitOfWork: UnitOfWork<PlanningWorkContext>,
    private readonly writeLog: WriteLog,
  ) {}

  execute(
    input: DeleteTodoCategoryInput,
  ): Promise<TodoWriteResult<TodoCategoryDeletion>> {
    return executeTodoCategoryWrite(
      this.writeLog,
      DELETE_TODO_CATEGORY_OPERATION,
      input.tripId,
      input.categoryId,
      (body) => body.id,
      async () =>
        runTodoTransaction(
          this.unitOfWork,
          { ...input, operation: DELETE_TODO_CATEGORY_OPERATION },
          async (ctx) => {
            const trip = await ctx.trips.lockForShare(
              input.tripId,
              input.userId,
            );
            if (trip === null) {
              throw tripNotAccessible();
            }
            const stored = await storedReceipt<TodoCategoryDeletion>(
              ctx,
              input.userId,
              DELETE_TODO_CATEGORY_OPERATION,
              input.key,
              input.requestHash,
            );
            if (stored !== null) {
              return stored;
            }
            const category = await ctx.todoCategories.lockForUpdate(
              trip.id,
              input.categoryId,
            );
            if (category === null) {
              throw todoCategoryNotFound();
            }
            const todoCount = await ctx.todos.countByCategory(
              trip.id,
              category.id,
            );
            if (todoCount !== input.expectedTodoCount) {
              throw new ApiError({
                code: "TODO_COUNT_CHANGED",
                status: 409,
                retryable: true,
                message: "Todo count in the category changed. Retry",
              });
            }
            const deletedTodoCount = await ctx.todos.deleteByCategory(
              trip.id,
              category.id,
            );
            await ctx.todoCategories.delete(trip.id, category.id);
            const body: TodoCategoryDeletion = {
              id: category.id,
              deletedTodoCount,
            };
            await ctx.receipts.insert({
              actorId: input.userId,
              operation: DELETE_TODO_CATEGORY_OPERATION,
              idempotencyKey: input.key,
              tripId: trip.id,
              requestHash: input.requestHash,
              resourceType: "todo_category_deletion",
              resourceId: category.id,
              httpStatus: 200,
              responseBody: body,
            });
            return { httpStatus: 200, body, replayed: false };
          },
        ),
    );
  }
}
