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
            });
            const body = toTodoDto(todo, null);
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
