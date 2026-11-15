import type { UnitOfWork } from "../../../adapter/transaction/unit-of-work.js";
import { ApiError } from "../../../common/http/api-error.js";
import {
  REORDER_TODO_CATEGORIES_OPERATION,
  type ReorderTodoCategoriesInput,
  type ReorderTodoCategoriesInputPort,
} from "../adapter/inbound/todo-category.input-port.js";
import type { TodoWriteResult } from "../adapter/inbound/todo.input-port.js";
import type { PlanningWorkContext } from "../adapter/outbound/planning-work-context.js";
import type { WriteLog } from "../adapter/outbound/write-log.port.js";
import {
  executeTodoCategoryWrite,
  toTodoCategoryDto,
} from "./todo-category-write-flow.js";
import { runTodoTransaction } from "./todo-write-flow.js";
import { storedReceipt, tripNotAccessible } from "./trip-write-flow.js";
import type { TodoCategoryOrder } from "@tomotabi/contracts";

/**
 * 並べ替え。`from`が今の順と同じときだけ保存し、`to`は`from`の並べ替え
 * （要件E-03）。同時の並べ替えは、ロックで片方が待ち、待った側は新しい
 * 並びと`from`が違って409になる。
 */
export class ReorderTodoCategoriesUseCase implements ReorderTodoCategoriesInputPort {
  constructor(
    private readonly unitOfWork: UnitOfWork<PlanningWorkContext>,
    private readonly writeLog: WriteLog,
  ) {}

  execute(
    input: ReorderTodoCategoriesInput,
  ): Promise<TodoWriteResult<TodoCategoryOrder>> {
    return executeTodoCategoryWrite(
      this.writeLog,
      REORDER_TODO_CATEGORIES_OPERATION,
      input.tripId,
      input.tripId,
      () => input.tripId,
      async () =>
        runTodoTransaction(
          this.unitOfWork,
          { ...input, operation: REORDER_TODO_CATEGORIES_OPERATION },
          async (ctx) => {
            const trip = await ctx.trips.lockForShare(
              input.tripId,
              input.userId,
            );
            if (trip === null) {
              throw tripNotAccessible();
            }
            const stored = await storedReceipt<TodoCategoryOrder>(
              ctx,
              input.userId,
              REORDER_TODO_CATEGORIES_OPERATION,
              input.key,
              input.requestHash,
            );
            if (stored !== null) {
              return stored;
            }
            await ctx.todoCategories.lockAllForUpdate(trip.id);
            // lockAllForUpdateは、ロックを待つ前に並べた順で行を返す。相手の
            // 並べ替えを待ったあとでも古い順のことがあるので、今の順は別の文で
            // 読み直す（READ COMMITTEDでは文ごとに新しいスナップショットを取る）。
            const categories = await ctx.todoCategories.listByTrip(trip.id);
            const current = categories.map((c) => c.id);
            if (!sameOrder(current, input.from)) {
              throw new ApiError({
                code: "TODO_CATEGORY_ORDER_CHANGED",
                status: 409,
                retryable: true,
                message: "Todo category order has changed. Retry",
              });
            }
            if (!isPermutation(input.from, input.to)) {
              throw new ApiError({
                code: "VALIDATION_FAILED",
                status: 422,
                message: "`to` must be a reorder of `from`",
              });
            }
            await ctx.todoCategories.updatePositions(trip.id, input.to);
            // 並べ替えたあとの順を返す。positionだけ変わる。
            const byId = new Map(categories.map((c) => [c.id, c]));
            const body: TodoCategoryOrder = {
              categories: input.to.map((id, index) =>
                toTodoCategoryDto({ ...byId.get(id)!, position: index }),
              ),
            };
            await ctx.receipts.insert({
              actorId: input.userId,
              operation: REORDER_TODO_CATEGORIES_OPERATION,
              idempotencyKey: input.key,
              tripId: trip.id,
              requestHash: input.requestHash,
              resourceType: "todo_category_order",
              resourceId: trip.id,
              httpStatus: 200,
              responseBody: body,
            });
            return { httpStatus: 200, body, replayed: false };
          },
        ),
    );
  }
}

function sameOrder(
  current: readonly string[],
  from: readonly string[],
): boolean {
  return (
    current.length === from.length &&
    current.every((id, index) => id === from[index])
  );
}

function isPermutation(
  from: readonly string[],
  to: readonly string[],
): boolean {
  return (
    from.length === to.length &&
    new Set(to).size === to.length &&
    to.every((id) => from.includes(id))
  );
}
