import type { Plan as PlanContract } from "@tomotabi/contracts";
import { ApiError } from "../../../common/http/api-error";
import type { UserId } from "../../../common/domain/user-id";
import type { IdempotencyKey } from "../../../common/http/idempotency-key";
import {
  PlanCancelledError,
  PlanHasRecordHistoryError,
  type Plan,
} from "../domain/plan";
import type { Trip } from "../domain/trip";
import type { PlanWriteResult } from "../adapter/inbound/plan-write.result";
import type { PlanningWorkContext } from "../adapter/outbound/planning-work-context";
import type { WriteLog } from "../adapter/outbound/write-log.port";
import { toPlanDto } from "./plan-dto";
import {
  storedReceipt,
  tripNotAccessible,
  type WriteOutcome,
} from "./trip-write-flow";

export type PlanWriteOutcome = WriteOutcome<PlanContract>;

export type PlanWriteCommand = Readonly<{
  userId: UserId;
  tripId: string;
  planId: string;
  operation: string;
  key: IdempotencyKey;
  ifMatch: string;
  requestHash: string;
}>;

/**
 * 参加している旅行の中で、予定が無い・別の旅行の予定はどちらも
 * 同じ404（どちらも同じ応答で、存在を漏らさない）。
 */
export function planNotFound(): ApiError {
  return new ApiError({
    code: "PLAN_NOT_FOUND",
    status: 404,
    message: "Plan was not found in the trip",
  });
}

/**
 * 予定の書き込みの共通の流れ（設計書「書き込みの共通の流れ」）:
 * 旅行行FOR SHARE → receipt → 予定行FOR NO KEY UPDATE → If-Match →
 * Domain → 更新とreceiptを同じトランザクションで保存。
 *
 * 旅行はFOR SHAREにする。期間の変更はFOR UPDATEを取るため、こちらが
 * 先に取れば期間の変更が待ち、後なら確定した期間を見てDomainが検証する
 * （期間外の予定が残らない・E-18）。ロックは常に旅行 → 予定の順。
 *
 * 予定はFOR NO KEY UPDATEにする。キー無し列だけの更新で十分で、
 * M4の達成・予約INSERTが親行参照で取るロックと衝突しにくい。
 * 種類変更の履歴照会（E-19）もこのロックを持ったまま行う。
 */
export async function runPlanUpdate(
  ctx: PlanningWorkContext,
  command: PlanWriteCommand,
  change: (plan: Plan, trip: Trip, ctx: PlanningWorkContext) => Promise<Plan>,
): Promise<PlanWriteOutcome> {
  const trip = await ctx.trips.lockForShare(command.tripId, command.userId);
  if (trip === null) {
    throw tripNotAccessible();
  }
  const replayed = await storedReceipt<PlanContract>(
    ctx,
    command.userId,
    command.operation,
    command.key,
    command.requestHash,
  );
  if (replayed !== null) {
    return replayed;
  }
  const plan = await ctx.plans.lockForUpdate(command.tripId, command.planId);
  if (plan === null) {
    throw planNotFound();
  }
  if (String(plan.version) !== command.ifMatch) {
    throw new ApiError({
      code: "VERSION_CONFLICT",
      status: 409,
      message: "Plan was already updated. Fetch it again and retry",
    });
  }
  let updated: Plan;
  try {
    updated = await change(plan, trip, ctx);
  } catch (error) {
    if (error instanceof PlanHasRecordHistoryError) {
      throw new ApiError({
        code: "PLAN_HAS_RECORD_HISTORY",
        status: 409,
        message: "Plan kind cannot change once it has record history",
      });
    }
    if (error instanceof PlanCancelledError) {
      throw new ApiError({
        code: "PLAN_CANCELLED",
        status: 409,
        message: "Plan is already cancelled",
      });
    }
    throw error;
  }
  if (updated !== plan) {
    await ctx.plans.update(updated);
  }
  const [active, hasRecordHistory] = await Promise.all([
    ctx.recordHistory.activeEvents(plan.id),
    ctx.recordHistory.hasHistory(plan.id),
  ]);
  const body = toPlanDto(updated, { ...active, hasRecordHistory });
  await ctx.receipts.insert({
    actorId: command.userId,
    operation: command.operation,
    idempotencyKey: command.key,
    tripId: trip.id,
    requestHash: command.requestHash,
    resourceType: "plan",
    resourceId: plan.id,
    httpStatus: 200,
    responseBody: body,
  });
  return { httpStatus: 200, body, replayed: false };
}

/**
 * 予定の書き込み1件のログ。旅行版と同じく結果は
 * created / replayed / rejected(code)の3値。resourceIdは予定id。
 */
export async function executePlanWrite(
  writeLog: WriteLog,
  operation: string,
  tripId: string,
  planId: string | null,
  work: () => Promise<PlanWriteOutcome>,
): Promise<PlanWriteResult> {
  const startedAt = Date.now();
  try {
    const outcome = await work();
    writeLog.info({
      operation,
      tripId,
      resourceId: outcome.body.id,
      result: outcome.replayed ? "replayed" : "created",
      errorCode: null,
      durationMs: Date.now() - startedAt,
    });
    return { httpStatus: outcome.httpStatus, body: outcome.body };
  } catch (error) {
    if (error instanceof ApiError) {
      writeLog.info({
        operation,
        tripId,
        resourceId: planId,
        result: "rejected",
        errorCode: error.code,
        durationMs: Date.now() - startedAt,
      });
    }
    throw error;
  }
}
