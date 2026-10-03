import type { Plan as PlanContract } from "@tomotabi/contracts";
import { ApiError } from "../../../common/http/api-error";
import type { Clock } from "../../../adapter/clock/clock";
import type { UnitOfWork } from "../../../adapter/transaction/unit-of-work";
import { TripPeriod } from "../domain/trip-period";
import {
  CREATE_PLAN_OPERATION,
  type CreatePlanInput,
  type CreatePlanInputPort,
} from "../adapter/inbound/create-plan.input-port";
import type { PlanWriteResult } from "../adapter/inbound/plan-write.result";
import type { PlanningWorkContext } from "../adapter/outbound/planning-work-context";
import type { WriteLog } from "../adapter/outbound/write-log.port";
import { parsePlanDate, parsePlanKind, parsePlanMemo, parsePlanName, parsePlanTime } from "./plan-input";
import { toPlanDto } from "./plan-dto";
import { executePlanWrite, type PlanWriteOutcome } from "./plan-write-flow";
import {
  isUniqueViolation,
  storedReceipt,
  tripNotAccessible,
} from "./trip-write-flow";

/**
 * 予定の追加。旅行行はFOR SHAREにする。期間の変更はFOR UPDATEを取るため、
 * こちらが先に取れば期間変更が待ち、後なら確定した期間で検証する（E-18）。
 */
export class CreatePlanUseCase implements CreatePlanInputPort {
  constructor(
    private readonly unitOfWork: UnitOfWork<PlanningWorkContext>,
    private readonly clock: Clock,
    private readonly writeLog: WriteLog,
  ) {}

  execute(input: CreatePlanInput): Promise<PlanWriteResult> {
    return executePlanWrite(
      this.writeLog,
      CREATE_PLAN_OPERATION,
      input.tripId,
      null,
      () => this.run(input),
    );
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
          return stored;
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
        return { httpStatus: 201, body, replayed: false };
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
        return stored;
      });
    }
  }
}
