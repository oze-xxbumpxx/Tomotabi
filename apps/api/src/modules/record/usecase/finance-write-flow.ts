import { ApiError } from "../../../common/http/api-error";
import type { CommandReceipt } from "../../../common/idempotency/command-receipt";
import type { IdempotencyKey } from "../../../common/http/idempotency-key";
import type { UserId } from "../../../common/domain/user-id";
import {
  tripNotAccessible,
  type WriteOutcome,
} from "../../planning/usecase/trip-write-flow";
import type { WriteLog } from "../../planning/adapter/outbound/write-log.port";
import type {
  FinanceWorkContext,
  TripRosterEntry,
} from "../adapter/outbound/finance-work-context";

/**
 * 財務の書き込みの結果。WriteOutcome に加えて、書き込みログが使う
 * 対象行の id（receipt の再送では保存した receipt の resourceId）を持つ。
 */
export type FinanceWriteOutcome<T> = WriteOutcome<T> &
  Readonly<{ resourceId: string }>;

export type FinanceWriteCommand = Readonly<{
  userId: UserId;
  tripId: string;
  operation: string;
  key: IdempotencyKey;
  requestHash: string;
}>;

/**
 * work が保存した結果。receipt の記録は runFinanceWrite が行う。
 * resourceType・resourceId は receipt の行に入る対象の種類と id。
 */
export type FinanceWritePersist<T> = Readonly<{
  body: T;
  httpStatus: 200 | 201;
  resourceType: CommandReceipt["resourceType"];
  resourceId: string;
}>;

/**
 * お金の書き込みの共通の流れ（設計書「書き込みの共通の流れ（財務）」、F-41）:
 *   1. 旅行の参加者か（無い・参加していない → 403 TRIP_NOT_ACCESSIBLE）
 *   2. trip_finance_guards の行を FOR UPDATE（同じ旅行の書き込みを一列に並べる）
 *   3. receipt を (userId, operation, key) で探す
 *      （あり・hash 一致 → 保存した結果、あり・不一致 → 409 IDEMPOTENCY_KEY_REUSED）
 *   4. ロックの後で対象を読み、業務規則で検証する（work の側）
 *   5. 履歴と receipt を同じトランザクションで保存する
 *
 * guard の行のロックで直列化されるため、同一キーの同時実行は receipt の
 * 照会で勝った側の結果を読む（PK 違反は起きない）。
 */
export async function runFinanceWrite<T>(
  ctx: FinanceWorkContext,
  command: FinanceWriteCommand,
  work: (
    ctx: FinanceWorkContext,
    roster: readonly TripRosterEntry[],
  ) => Promise<FinanceWritePersist<T>>,
): Promise<FinanceWriteOutcome<T>> {
  const roster = await ctx.roster.find(command.tripId, command.userId);
  if (roster === null) {
    throw tripNotAccessible();
  }
  await ctx.financeGuard.lock(command.tripId);
  const receipt = await ctx.receipts.find(
    command.userId,
    command.operation,
    command.key,
  );
  if (receipt !== null) {
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
  const persisted = await work(ctx, roster);
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
 * 財務の書き込み 1 件のログ（設計書「ログと監視」）。旅行・予定の書き込み
 * と同じく結果は created / replayed / rejected(code) の 3 値で、
 * 金額・用途など利用者の入力は含めない。
 */
export async function executeFinanceWrite<T>(
  writeLog: WriteLog,
  operation: string,
  tripId: string,
  resourceId: string | null,
  work: () => Promise<FinanceWriteOutcome<T>>,
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
