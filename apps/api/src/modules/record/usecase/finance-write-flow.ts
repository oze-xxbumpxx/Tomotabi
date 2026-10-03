import type { UnitOfWork } from "../../../adapter/transaction/unit-of-work";
import { ApiError } from "../../../common/http/api-error";
import type { CommandReceipt } from "../../../common/idempotency/command-receipt";
import type { IdempotencyKey } from "../../../common/http/idempotency-key";
import type { UserId } from "../../../common/domain/user-id";
import {
  isUniqueViolation,
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

async function storedFinanceReceipt<T>(
  ctx: Pick<FinanceWorkContext, "receipts">,
  command: FinanceWriteCommand,
): Promise<FinanceWriteOutcome<T> | null> {
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
 * お金の書き込みの共通の流れ（設計書「書き込みの共通の流れ（財務）」、F-41）:
 *   1. 旅行の参加者か（無い・参加していない → 403 TRIP_NOT_ACCESSIBLE）
 *   2. trip_finance_guards の行を FOR UPDATE（同じ旅行の書き込みを一列に並べる）
 *   3. receipt を (userId, operation, key) で探す
 *      （あり・hash 一致 → 保存した結果、あり・不一致 → 409 IDEMPOTENCY_KEY_REUSED）
 *   4. ロックの後で対象を読み、業務規則で検証する（work の側）
 *   5. 履歴と receipt を同じトランザクションで保存する
 *
 * 同じ旅行の同一キーは guard の行ロックで直列化される（先着の receipt を後着が
 * 読む）。ただし receipt の主キーは旅行を含まないため、別の旅行への同時送信は
 * runFinanceWriteTransaction の一意違反の扱いが要る。
 *
 * 文脈は FinanceWorkContext を広げたものでも渡せる（C）。settlement の
 * 書き込みは支払いの読み取り口と settlement の Repository を足した文脈で
 * 同じ流れを通る。
 */
export async function runFinanceWrite<
  T,
  C extends FinanceWorkContext = FinanceWorkContext,
>(
  ctx: C,
  command: FinanceWriteCommand,
  work: (
    ctx: C,
    roster: readonly TripRosterEntry[],
  ) => Promise<FinanceWritePersist<T>>,
): Promise<FinanceWriteOutcome<T>> {
  const roster = await ctx.roster.find(command.tripId, command.userId);
  if (roster === null) {
    throw tripNotAccessible();
  }
  await ctx.financeGuard.lock(command.tripId);
  const stored = await storedFinanceReceipt<T>(ctx, command);
  if (stored !== null) {
    return stored;
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
 * runFinanceWrite を 1 トランザクションで走らせる。財務の UseCase は
 * 直接 unitOfWork.run せずここを通る。
 *
 * 受領の主キーは (actor_id, operation, idempotency_key) で旅行を含まない。
 * 札のロックは旅行ごとなので、同じ利用者・同じ操作・同じキーを別の旅行へ
 * 同時に送ると、両方が受領を見つけられずに進み、後からコミットした側が
 * 一意違反（23505）で負ける。その時点でこちらはロールバック済みなので、
 * 勝った側が COMMIT した受領を新しいトランザクションで読み直す（hash が
 * 一致すれば保存した結果、違えば 409）。旅行・予定の作成と同じ仕組み。
 */
export async function runFinanceWriteTransaction<
  T,
  C extends FinanceWorkContext = FinanceWorkContext,
>(
  unitOfWork: UnitOfWork<C>,
  command: FinanceWriteCommand,
  work: (
    ctx: C,
    roster: readonly TripRosterEntry[],
  ) => Promise<FinanceWritePersist<T>>,
): Promise<FinanceWriteOutcome<T>> {
  try {
    return await unitOfWork.run((ctx) =>
      runFinanceWrite(ctx, command, work),
    );
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }
    return unitOfWork.run(async (ctx) => {
      const stored = await storedFinanceReceipt<T>(ctx, command);
      if (stored === null) {
        // 受領以外の一意違反だった場合に備えて元のエラーを投げ直す
        throw error;
      }
      return stored;
    });
  }
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
