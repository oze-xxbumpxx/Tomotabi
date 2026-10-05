import type { UnitOfWork } from "../../../adapter/transaction/unit-of-work";
import { ApiError } from "../../../common/http/api-error";
import type { CommandReceipt } from "../../../common/idempotency/command-receipt";
import type { IdempotencyKey } from "../../../common/http/idempotency-key";
import type { UserId } from "../../../common/domain/user-id";
import type { WriteLog } from "../../planning/adapter/outbound/write-log.port";
import type { PlanEventWorkContext } from "../adapter/outbound/plan-event-work-context";
import {
  isUniqueViolation,
  tripNotAccessible,
  type WriteOutcome,
} from "../../planning/usecase/trip-write-flow";

/**
 * 達成・予約の書き込みの結果。WriteOutcomeに加えて、書き込みログが
 * 使う対象行のid（receiptの再送では保存したreceiptのresourceId）を持つ。
 */
export type PlanEventWriteOutcome<T> = WriteOutcome<T> &
  Readonly<{ resourceId: string }>;

export type PlanEventWriteCommand = Readonly<{
  userId: UserId;
  tripId: string;
  operation: string;
  key: IdempotencyKey;
  requestHash: string;
}>;

/**
 * workが保存した結果。receiptの記録はrunPlanEventWriteが行う。
 * resourceType・resourceIdはreceiptの行に入る対象の種類とid。
 */
export type PlanEventWritePersist<T> = Readonly<{
  body: T;
  httpStatus: 200 | 201;
  resourceType: CommandReceipt["resourceType"];
  resourceId: string;
}>;

async function storedPlanEventReceipt<T>(
  ctx: Pick<PlanEventWorkContext, "receipts">,
  command: PlanEventWriteCommand,
): Promise<PlanEventWriteOutcome<T> | null> {
  const receipt = await ctx.receipts.find(
    command.userId,
    command.operation,
    command.key,
  );
  if (receipt === null) {
    return null;
  }
  if (receipt.requestHash !== command.requestHash) {
    throw new ApiError({
      code: "IDEMPOTENCY_KEY_REUSED",
      status: 409,
      message:
        "Idempotency-Key was already used for a different request",
    });
  }
  return {
    httpStatus: receipt.httpStatus,
    body: receipt.responseBody as T,
    replayed: true,
    resourceId: receipt.resourceId,
  };
}

/**
 * 達成・予約の書き込みの共通の流れ（設計書「書き込みの共通の流れ（記録）」）:
 *   1. 旅行の行をFOR SHARE（参加しているか。無い・参加していない →
 *      403 TRIP_NOT_ACCESSIBLE）
 *   2. receiptを(userId, operation, key)で探す
 *      （あり・hash一致 → 保存した結果、あり・不一致 →
 *      409 IDEMPOTENCY_KEY_REUSED）
 *   3. 予定の行をFOR NO KEY UPDATEで取ってから業務規則を確かめる
 *      （workの側。予定の書き込みと同じロック順で一列に並ぶ）
 *   4. 履歴・占有行とreceiptを同じトランザクションで保存する
 *
 * お金の順番待ちの行は取らない。支払いの書き込みはguard行を先に取るため、
 * こちらが旅行・予定のロックを持ったままguardを取るとロック順が逆になる。
 */
export async function runPlanEventWrite<T>(
  ctx: PlanEventWorkContext,
  command: PlanEventWriteCommand,
  work: (ctx: PlanEventWorkContext) => Promise<PlanEventWritePersist<T>>,
): Promise<PlanEventWriteOutcome<T>> {
  const trip = await ctx.trips.lockForShare(command.tripId, command.userId);
  if (trip === null) {
    throw tripNotAccessible();
  }
  const stored = await storedPlanEventReceipt<T>(ctx, command);
  if (stored !== null) {
    return stored;
  }
  const persisted = await work(ctx);
  await ctx.receipts.insert({
    actorId: command.userId,
    operation: command.operation,
    idempotencyKey: command.key,
    tripId: command.tripId,
    requestHash: command.requestHash,
    resourceType: persisted.resourceType,
    resourceId: persisted.resourceId,
    httpStatus: persisted.httpStatus,
    responseBody: persisted.body,
  });
  return {
    httpStatus: persisted.httpStatus,
    body: persisted.body,
    replayed: false,
    resourceId: persisted.resourceId,
  };
}

/**
 * runPlanEventWriteを1トランザクションで走らせる。一意違反（23505）で
 * ロールバックしたときは新しいトランザクションで読み直す。
 *
 * 一意違反の出どころは2つある:
 * - receiptの主キー(actor_id, operation, idempotency_key): 同じキーを
 *   別の旅行・別の予定へ同時に送ったとき。先にコミットした側の受領を
 *   読み直して同じ結果を返す（hashが違えば409 IDEMPOTENCY_KEY_REUSED）
 * - active_plan_eventsの主キー(plan_id, event_kind): 別の接続が先に
 *   同じ予定・種類を足したとき。resolveUniqueViolationが今ある記録を
 *   読んで409に写す（どちらも説明できない違反なら元のエラーを投げ直す）
 */
export async function runPlanEventWriteTransaction<T>(
  unitOfWork: UnitOfWork<PlanEventWorkContext>,
  command: PlanEventWriteCommand,
  work: (ctx: PlanEventWorkContext) => Promise<PlanEventWritePersist<T>>,
  resolveUniqueViolation: (
    ctx: PlanEventWorkContext,
  ) => Promise<PlanEventWriteOutcome<T> | null>,
): Promise<PlanEventWriteOutcome<T>> {
  try {
    return await unitOfWork.run((ctx) => runPlanEventWrite(ctx, command, work));
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }
    return unitOfWork.run(async (ctx) => {
      const stored = await storedPlanEventReceipt<T>(ctx, command);
      if (stored !== null) {
        return stored;
      }
      const resolved = await resolveUniqueViolation(ctx);
      if (resolved === null) {
        throw error;
      }
      return resolved;
    });
  }
}

/**
 * 達成・予約の書き込み1件のログ（設計書「ログと監視」）。支払いと同じく
 * 結果はcreated / replayed / rejected(code)の3値で、予定idなど
 * 利用者の入力はresourceId以外に含めない。
 */
export async function executePlanEventWrite<T>(
  writeLog: WriteLog,
  operation: string,
  tripId: string,
  resourceId: string | null,
  work: () => Promise<PlanEventWriteOutcome<T>>,
): Promise<{ httpStatus: 200 | 201; body: T }> {
  const startedAt = Date.now();
  try {
    const outcome = await work();
    writeLog.info({
      operation,
      tripId,
      resourceId: outcome.resourceId,
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
        resourceId,
        result: "rejected",
        errorCode: error.code,
        durationMs: Date.now() - startedAt,
      });
    }
    throw error;
  }
}
