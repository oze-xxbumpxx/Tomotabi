import { ApiError } from "../../../common/http/api-error.js";
import type { UnitOfWork } from "../../../adapter/transaction/unit-of-work.js";
import {
  CREATE_TODO_CATEGORY_OPERATION,
  type CreateTodoCategoryInput,
  type CreateTodoCategoryInputPort,
} from "../adapter/inbound/todo-category.input-port.js";
import type { TodoWriteResult } from "../adapter/inbound/todo.input-port.js";
import type { PlanningWorkContext } from "../adapter/outbound/planning-work-context.js";
import type { WriteLog } from "../adapter/outbound/write-log.port.js";
import {
  executeTodoCategoryWrite,
  toTodoCategoryDto,
} from "./todo-category-write-flow.js";
import { parseTodoCategoryName } from "./plan-input.js";
import { runTodoTransaction } from "./todo-write-flow.js";
import { storedReceipt, tripNotAccessible } from "./trip-write-flow.js";
import type { TodoCategory } from "@tomotabi/contracts";

/** 一つの旅行に置けるカテゴリの数（要件B-01）。 */
export const TODO_CATEGORY_LIMIT = 20;

/**
 * カテゴリの追加。追加は旅行のカテゴリを全部FOR UPDATEでロックしてから
 * 件数を数えるので、二人が同時に追加しても上限を超えない（要件E-02）。
 */
export class CreateTodoCategoryUseCase implements CreateTodoCategoryInputPort {
  constructor(
    private readonly unitOfWork: UnitOfWork<PlanningWorkContext>,
    private readonly writeLog: WriteLog,
  ) {}

  execute(input: CreateTodoCategoryInput): Promise<TodoWriteResult<TodoCategory>> {
    return executeTodoCategoryWrite(
      this.writeLog,
      CREATE_TODO_CATEGORY_OPERATION,
      input.tripId,
      null,
      (body) => body.id,
      async () => {
        const name = parseTodoCategoryName(input.name);
        return runTodoTransaction(
          this.unitOfWork,
          { ...input, operation: CREATE_TODO_CATEGORY_OPERATION },
          async (ctx) => {
            const trip = await ctx.trips.lockForShare(
              input.tripId,
              input.userId,
            );
            if (trip === null) {
              throw tripNotAccessible();
            }
            const stored = await storedReceipt<TodoCategory>(
              ctx,
              input.userId,
              CREATE_TODO_CATEGORY_OPERATION,
              input.key,
              input.requestHash,
            );
            if (stored !== null) {
              return stored;
            }
            const categories = await ctx.todoCategories.lockAllForUpdate(
              trip.id,
            );
            if (categories.length >= TODO_CATEGORY_LIMIT) {
              throw new ApiError({
                code: "TODO_CATEGORY_LIMIT_REACHED",
                status: 422,
                message: `A trip can have at most ${TODO_CATEGORY_LIMIT} todo categories`,
              });
            }
            const position =
              categories.length === 0
                ? 0
                : Math.max(...categories.map((c) => c.position)) + 1;
            const category = await ctx.todoCategories.insert({
              tripId: trip.id,
              name,
              position,
              createdBy: input.userId,
            });
            const body = toTodoCategoryDto(category);
            await ctx.receipts.insert({
              actorId: input.userId,
              operation: CREATE_TODO_CATEGORY_OPERATION,
              idempotencyKey: input.key,
              tripId: trip.id,
              requestHash: input.requestHash,
              resourceType: "todo_category",
              resourceId: category.id,
              httpStatus: 201,
              responseBody: body,
            });
            return { httpStatus: 201, body, replayed: false };
          },
        );
      },
    );
  }
}
