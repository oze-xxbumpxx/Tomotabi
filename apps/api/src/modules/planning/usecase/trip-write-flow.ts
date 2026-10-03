import type { Trip as TripContract } from "@tomotabi/contracts";
import { someInCauseChain } from "../../../common/errors/find-in-cause-chain";
import { ApiError } from "../../../common/http/api-error";
import type { UserId } from "../../../common/domain/user-id";
import type { IdempotencyKey } from "../../../common/http/idempotency-key";
import { InvalidTripTransitionError, type Trip } from "../domain/trip";
import type { PlanningWorkContext } from "../adapter/outbound/planning-work-context";
import type { TripWriteResult } from "../adapter/inbound/trip-write.result";
import type { WriteLog } from "../adapter/outbound/write-log.port";
import { toTripDto } from "./trip-dto";

export type WriteOutcome<T> = Readonly<{
  httpStatus: 200 | 201;
  body: T;
  /** receiptに残った元の結果を返したときtrue */
  replayed: boolean;
}>;

export type TripWriteOutcome = WriteOutcome<TripContract>;

export type TripUpdateCommand = Readonly<{
  userId: UserId;
  tripId: string;
  operation: string;
  key: IdempotencyKey;
  ifMatch: string;
  requestHash: string;
}>;

export function tripNotAccessible(): ApiError {
  // 存在しない・参加していないは同じ403（存在を漏らさない。差分3）。
  return new ApiError({
    code: "TRIP_NOT_ACCESSIBLE",
    status: 403,
    message: "Trip is not accessible",
  });
}

/**
 * receiptを先に読む。同じキーの再送は（別の利用者がその後で更新していても）
 * 元の結果を返す決まりなので、If-Matchの検査より先に見る（設計書「書き込みの
 * 共通の流れ」2）。request_hashが違う同一キーは409 IDEMPOTENCY_KEY_REUSED。
 */
export async function storedReceipt<T>(
  ctx: PlanningWorkContext,
  actorId: UserId,
  operation: string,
  key: IdempotencyKey,
  requestHash: string,
): Promise<WriteOutcome<T> | null> {
  const receipt = await ctx.receipts.find(actorId, operation, key);
  if (receipt === null) {
    return null;
  }
  if (receipt.requestHash !== requestHash) {
    throw new ApiError({
      code: "IDEMPOTENCY_KEY_REUSED",
      status: 409,
      message: "Idempotency-Key was already used for a different request",
    });
  }
  return {
    httpStatus: receipt.httpStatus,
    body: receipt.responseBody as T,
    replayed: true,
  };
}

/**
 * 旅行が絡む書き込みの共通の流れ（設計書）: 旅行行のロック → receipt →
 * If-Match → Domain → 更新とreceiptを同じトランザクションで保存。
 * ロックは常に旅行 → 予定の順。M2-b・M3でも同じ順にしないとデッドロックする。
 */
export async function runTripUpdate(
  ctx: PlanningWorkContext,
  command: TripUpdateCommand,
  change: (trip: Trip, ctx: PlanningWorkContext) => Promise<Trip>,
): Promise<TripWriteOutcome> {
  const trip = await ctx.trips.lockForUpdate(command.tripId, command.userId);
  if (trip === null) {
    throw tripNotAccessible();
  }
  const replayed = await storedReceipt<TripContract>(
    ctx,
    command.userId,
    command.operation,
    command.key,
    command.requestHash,
  );
  if (replayed !== null) {
    return replayed;
  }
  if (String(trip.version) !== command.ifMatch) {
    throw new ApiError({
      code: "VERSION_CONFLICT",
      status: 409,
      message: "Trip was already updated. Fetch it again and retry",
    });
  }
  let updated: Trip;
  try {
    updated = await change(trip, ctx);
  } catch (error) {
    if (error instanceof InvalidTripTransitionError) {
      throw new ApiError({
        code: "INVALID_TRIP_TRANSITION",
        status: 409,
        message: "Trip cannot be moved to that state",
      });
    }
    throw error;
  }
  if (updated !== trip) {
    await ctx.trips.update(updated);
  }
  const body = toTripDto(updated);
  await ctx.receipts.insert({
    actorId: command.userId,
    operation: command.operation,
    idempotencyKey: command.key,
    tripId: trip.id,
    requestHash: command.requestHash,
    resourceType: "trip",
    resourceId: trip.id,
    httpStatus: 200,
    responseBody: body,
  });
  return { httpStatus: 200, body, replayed: false };
}

/**
 * 業務の書き込み1件のログ（設計書「ログと監視」）。結果は
 * created / replayed / rejected(code)の3値で、所要時間を付ける。
 * ここではApiError（業務の拒否）だけを数え、想定外の例外は例外ログに任せる。
 */
export async function executeTripWrite(
  writeLog: WriteLog,
  operation: string,
  tripId: string | null,
  work: () => Promise<TripWriteOutcome>,
): Promise<TripWriteResult> {
  const startedAt = Date.now();
  try {
    const outcome = await work();
    writeLog.info({
      operation,
      tripId: outcome.body.id,
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
        resourceId: tripId,
        result: "rejected",
        errorCode: error.code,
        durationMs: Date.now() - startedAt,
      });
    }
    throw error;
  }
}

/**
 * 同じキーの同時作成はreceiptのPK違反で負ける側が分かる。
 * createTripでは他に一意制約が衝突し得ないため、23505はその兆候。
 * pgのエラーはDrizzleQueryErrorのcauseに入って届くため、
 * causeチェーンを辿ってSQLSTATEを見る。
 */
export function isUniqueViolation(error: unknown): boolean {
  return someInCauseChain(
    error,
    (node) => (node as { code?: unknown }).code === "23505",
  );
}
