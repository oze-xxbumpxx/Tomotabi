import type { Clock } from "../../../adapter/clock/clock.js";
import type { UnitOfWork } from "../../../adapter/transaction/unit-of-work.js";
import { ApiError } from "../../../common/http/api-error.js";
import {
  UPDATE_TODO_CATEGORY_OPERATION,
  type UpdateTodoCategoryInput,
  type UpdateTodoCategoryInputPort,
} from "../adapter/inbound/todo-category.input-port.js";
import type { TodoWriteResult } from "../adapter/inbound/todo.input-port.js";
import type { PlanningWorkContext } from "../adapter/outbound/planning-work-context.js";
import type { WriteLog } from "../adapter/outbound/write-log.port.js";
import {
  executeTodoCategoryWrite,
  todoCategoryNotFound,
  toTodoCategoryDto,
} from "./todo-category-write-flow.js";
import { TodoCategory } from "../domain/todo-category.js";
import { parseTodoCategoryName } from "./plan-input.js";
import { runTodoTransaction } from "./todo-write-flow.js";
import { storedReceipt, tripNotAccessible } from "./trip-write-flow.js";
import type { TodoCategory as TodoCategoryContract } from "@tomotabi/contracts";

/** カテゴリの名前の変更。ToDoの編集と同じく版を確かめる。 */
export class UpdateTodoCategoryUseCase implements UpdateTodoCategoryInputPort {
  constructor(
    private readonly unitOfWork: UnitOfWork<PlanningWorkContext>,
    private readonly clock: Clock,
    private readonly writeLog: WriteLog,
  ) {}

  execute(
    input: UpdateTodoCategoryInput,
  ): Promise<TodoWriteResult<TodoCategoryContract>> {
    return executeTodoCategoryWrite(
      this.writeLog,
      UPDATE_TODO_CATEGORY_OPERATION,
      input.tripId,
      input.categoryId,
      (body) => body.id,
      async () => {
        const name = parseTodoCategoryName(input.name);
        return runTodoTransaction(
          this.unitOfWork,
          { ...input, operation: UPDATE_TODO_CATEGORY_OPERATION },
          async (ctx) => {
            const trip = await ctx.trips.lockForShare(
              input.tripId,
              input.userId,
            );
            if (trip === null) {
              throw tripNotAccessible();
            }
            const stored = await storedReceipt<TodoCategoryContract>(
              ctx,
              input.userId,
              UPDATE_TODO_CATEGORY_OPERATION,
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
            if (String(category.version) !== input.ifMatch) {
              throw new ApiError({
                code: "VERSION_CONFLICT",
                status: 409,
                message: "Todo category was already updated. Retry",
              });
            }
            const updated = TodoCategory.rename(
              category,
              name,
              this.clock.now(),
            );
            if (updated !== category) {
              await ctx.todoCategories.update(updated);
            }
            const body = toTodoCategoryDto(updated);
            await ctx.receipts.insert({
              actorId: input.userId,
              operation: UPDATE_TODO_CATEGORY_OPERATION,
              idempotencyKey: input.key,
              tripId: trip.id,
              requestHash: input.requestHash,
              resourceType: "todo_category",
              resourceId: category.id,
              httpStatus: 200,
              responseBody: body,
            });
            return { httpStatus: 200, body, replayed: false };
          },
        );
      },
    );
  }
}
