import type { Trip as TripContract } from "@tomotabi/contracts";
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
  /** receipt に残った元の結果を返したとき true */
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
  // 存在しない・参加していないは同じ 403（存在を漏らさない。差分 3）。
  return new ApiError({
    code: "TRIP_NOT_ACCESSIBLE",
    status: 403,
    message: "Trip is not accessible",
  });
}

/**
 * receipt を先に読む。同じキーの再送は（別の利用者がその後で更新していても）
 * 元の結果を返す決まりなので、If-Match の検査より先に見る（設計書「書き込みの
 * 共通の流れ」2）。request_hash が違う同一キーは 409 IDEMPOTENCY_KEY_REUSED。
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
 * If-Match → Domain → 更新と receipt を同じトランザクションで保存。
 * ロックは常に旅行 → 予定の順。M2-b・M3 でも同じ順にしないとデッドロックする。
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
 * 業務の書き込み 1 件のログ（設計書「ログと監視」）。結果は
 * created / replayed / rejected(code) の 3 値で、所要時間を付ける。
 * ここでは ApiError（業務の拒否）だけを数え、想定外の例外は例外ログに任せる。
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

/** cause チェーンを辿る深さの上限（循環する cause でも打ち切る）。 */
const MAX_CAUSE_DEPTH = 8;

/**
 * 同じキーの同時作成は receipt の PK 違反で負ける側が分かる。
 * createTrip では他に一意制約が衝突し得ないため、23505 はその兆候。
 * pg のエラーは DrizzleQueryError の cause に入って届くため、
 * cause チェーンを辿って SQLSTATE を見る。
 */
export function isUniqueViolation(error: unknown): boolean {
  // 循環する cause が届いても終わるよう、深さに上限を設ける。
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
    if (typeof current !== "object" || current === null) {
      return false;
    }
    if ((current as { code?: unknown }).code === "23505") {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
