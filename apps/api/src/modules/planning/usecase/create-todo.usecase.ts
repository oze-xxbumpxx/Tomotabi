import { ApiError } from "../../../common/http/api-error.js";
import type { UnitOfWork } from "../../../adapter/transaction/unit-of-work.js";
import {
  CREATE_TODO_OPERATION,
  type CreateTodoInput,
  type CreateTodoInputPort,
  type TodoWriteResult,
} from "../adapter/inbound/todo.input-port.js";
import type { PlanningWorkContext } from "../adapter/outbound/planning-work-context.js";
import type { WriteLog } from "../adapter/outbound/write-log.port.js";
import { parsePlanName } from "./plan-input.js";
import { toTodoDto } from "./todo-dto.js";
import {
  executeTodoWrite,
  runTodoTransaction,
  TODO_LIMIT,
} from "./todo-write-flow.js";
import { storedReceipt, tripNotAccessible } from "./trip-write-flow.js";
import type { Todo as TodoContract } from "@tomotabi/contracts";

/**
 * ToDoの追加。旅行行はFOR SHAREにして件数を数える。二人が同時に追加すると
 * 同時に送った本数だけ上限を超えることがあるが、上限はリストの長さを抑えるためなので許す
 * （設計書「DB 設計」）。
 */
export class CreateTodoUseCase implements CreateTodoInputPort {
  constructor(
    private readonly unitOfWork: UnitOfWork<PlanningWorkContext>,
    private readonly writeLog: WriteLog,
  ) {}

  execute(input: CreateTodoInput): Promise<TodoWriteResult> {
    return executeTodoWrite(
      this.writeLog,
      CREATE_TODO_OPERATION,
      input.tripId,
      null,
      async () => {
        const name = parsePlanName(input.name);
        return runTodoTransaction(
          this.unitOfWork,
          { ...input, operation: CREATE_TODO_OPERATION },
          async (ctx) => {
            const trip = await ctx.trips.lockForShare(
              input.tripId,
              input.userId,
            );
            if (trip === null) {
              throw tripNotAccessible();
            }
            const stored = await storedReceipt<TodoContract>(
              ctx,
              input.userId,
              CREATE_TODO_OPERATION,
              input.key,
              input.requestHash,
            );
            if (stored !== null) {
              return stored;
            }
            // planIdは同じ旅行の、取りやめていない予定を同じトランザクションで
            // 確かめる（FOR SHARE。ロックの順は旅行 → 予定 → カテゴリ → ToDo。
            // 設計書 todo-organize「UseCase 設計」）。
            const planId = input.planId ?? null;
            if (planId !== null) {
              const plan = await ctx.plans.lockForShare(trip.id, planId);
              if (plan === null || plan.cancelledAt !== null) {
                throw new ApiError({
                  code: "TODO_PLAN_NOT_AVAILABLE",
                  status: 422,
                  message: "Plan is not available to link in the trip",
                });
              }
            }
            // categoryIdは同じ旅行のカテゴリを同じトランザクションで確かめる
            // （FOR SHARE。設計書 todo-organize「UseCase 設計」）。
            const categoryId = input.categoryId ?? null;
            if (categoryId !== null) {
              const category = await ctx.todoCategories.lockForShare(
                trip.id,
                categoryId,
              );
              if (category === null) {
                throw new ApiError({
                  code: "TODO_CATEGORY_NOT_FOUND",
                  status: 422,
                  message: "Todo category not found in the trip",
                });
              }
            }
            if ((await ctx.todos.countByTrip(trip.id)) >= TODO_LIMIT) {
              throw new ApiError({
                code: "TODO_LIMIT_REACHED",
                status: 422,
                message: `A trip can have at most ${TODO_LIMIT} ToDo items`,
              });
            }
            const todo = await ctx.todos.insert({
              tripId: trip.id,
              name,
              createdBy: input.userId,
              categoryId,
              planId,
            });
            const body = toTodoDto(
              todo,
              planId === null ? null : await ctx.todos.planLink(trip.id, planId),
            );
            await ctx.receipts.insert({
              actorId: input.userId,
              operation: CREATE_TODO_OPERATION,
              idempotencyKey: input.key,
              tripId: trip.id,
              requestHash: input.requestHash,
              resourceType: "todo",
              resourceId: todo.id,
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
