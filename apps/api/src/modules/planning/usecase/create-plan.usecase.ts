import { randomUUID } from "node:crypto";
import type { Plan as PlanContract } from "@tomotabi/contracts";
import { ApiError } from "../../../common/http/api-error.js";
import type { Clock } from "../../../adapter/clock/clock.js";
import type { UnitOfWork } from "../../../adapter/transaction/unit-of-work.js";
import { Todo } from "../domain/todo.js";
import { TripPeriod } from "../domain/trip-period.js";
import {
  CREATE_PLAN_OPERATION,
  type CreatePlanInput,
  type CreatePlanInputPort,
} from "../adapter/inbound/create-plan.input-port.js";
import type { PlanWriteResult } from "../adapter/inbound/plan-write.result.js";
import {
  noopNotificationPublisher,
  type NotificationPublisher,
} from "../adapter/outbound/notification-publisher.js";
import type { PlanningWorkContext } from "../adapter/outbound/planning-work-context.js";
import type { WriteLog } from "../adapter/outbound/write-log.port.js";
import { parsePlanDate, parsePlanKind, parsePlanMemo, parsePlanName, parsePlanTime } from "./plan-input.js";
import { toPlanDto } from "./plan-dto.js";
import { executePlanWrite, type PlanWriteOutcome } from "./plan-write-flow.js";
import {
  isUniqueViolation,
  storedReceipt,
  tripNotAccessible,
} from "./trip-write-flow.js";

/**
 * 予定の追加。旅行行はFOR SHAREにする。期間の変更はFOR UPDATEを取るため、
 * こちらが先に取れば期間変更が待ち、後なら確定した期間で検証する（E-18）。
 */
export class CreatePlanUseCase implements CreatePlanInputPort {
  constructor(
    private readonly unitOfWork: UnitOfWork<PlanningWorkContext>,
    private readonly clock: Clock,
    private readonly writeLog: WriteLog,
    private readonly publisher: NotificationPublisher =
      noopNotificationPublisher,
  ) {}

  execute(input: CreatePlanInput): Promise<PlanWriteResult> {
    return executePlanWrite(
      this.writeLog,
      CREATE_PLAN_OPERATION,
      input.tripId,
      null,
      async () => {
        const outcome = await this.run(input);
        if (!outcome.replayed) {
          // 再送でない新しい予定だけ。COMMITのあとで通知のイベントを渡す。
          this.publisher.publish({
            eventId: randomUUID(),
            action: "plan_added",
            targetKind: "plan",
            tripId: input.tripId,
            targetId: outcome.body.id,
            actorUserId: input.userId,
            occurredAt: this.clock.now().toISOString(),
          });
        }
        return outcome;
      },
    );
  }

  /**
   * 「予定にする」の元のToDoを、予定の保存と同じトランザクションで完了にして
   * 予定とつなぐ（要件F-10）。ロックは旅行 → 予定 → ToDoの順。
   * 無い（削除済み・別の旅行）・完了済みなら何もしない（E-05・E-06）。
   */
  private async completeSourceTodo(
    ctx: PlanningWorkContext,
    input: CreatePlanInput,
    todoId: string,
    planId: string,
  ): Promise<void> {
    const todo = await ctx.todos.lockForUpdate(input.tripId, todoId);
    if (todo === null) {
      return;
    }
    const done = Todo.complete(todo, input.userId, this.clock.now(), planId);
    if (done !== todo) {
      await ctx.todos.update(done);
    }
  }

  private async run(input: CreatePlanInput): Promise<PlanWriteOutcome> {
    const name = parsePlanName(input.name);
    const kind = parsePlanKind(input.kind);
    const date = parsePlanDate(input.date);
    const time = parsePlanTime(input.time);
    const memo = parsePlanMemo(input.memo);
    try {
      return await this.unitOfWork.run(async (ctx) => {
        const trip = await ctx.trips.lockForShare(input.tripId, input.userId);
        if (trip === null) {
          throw tripNotAccessible();
        }
        const stored = await storedReceipt<PlanContract>(
          ctx,
          input.userId,
          CREATE_PLAN_OPERATION,
          input.key,
          input.requestHash,
        );
        if (stored !== null) {
          return { ...stored, changed: false };
        }
        if (!TripPeriod.contains(trip.period, date)) {
          throw new ApiError({
            code: "PLAN_OUTSIDE_TRIP_PERIOD",
            status: 422,
            message: "Plan date is outside the trip period",
          });
        }
        const plan = await ctx.plans.insert({
          tripId: trip.id,
          name,
          kind,
          date,
          time,
          memo,
        });
        if (input.fromTodoId !== null) {
          await this.completeSourceTodo(ctx, input, input.fromTodoId, plan.id);
        }
        const body = toPlanDto(plan, {
          achievement: null,
          booking: null,
          hasRecordHistory: false,
        });
        await ctx.receipts.insert({
          actorId: input.userId,
          operation: CREATE_PLAN_OPERATION,
          idempotencyKey: input.key,
          tripId: trip.id,
          requestHash: input.requestHash,
          resourceType: "plan",
          resourceId: plan.id,
          httpStatus: 201,
          responseBody: body,
        });
        return { httpStatus: 201, body, replayed: false, changed: true };
      });
    } catch (error) {
      // 同じキーの同時作成はreceiptのPK違反で負ける側が分かる（旅行の
      // 作成と同じ仕組み）。勝った側がCOMMITしたreceiptを読み直す。
      if (!isUniqueViolation(error)) {
        throw error;
      }
      return this.unitOfWork.run(async (ctx) => {
        const stored = await storedReceipt<PlanContract>(
          ctx,
          input.userId,
          CREATE_PLAN_OPERATION,
          input.key,
          input.requestHash,
        );
        if (stored === null) {
          throw error;
        }
        return { ...stored, changed: false };
      });
    }
  }
}
