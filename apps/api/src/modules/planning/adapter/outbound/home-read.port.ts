import type { UnitOfWork } from "../../../../adapter/transaction/unit-of-work";
import type { ParticipantSlot } from "../../../../common/domain/participant-slot";
import type { LocalDate } from "../../../../common/domain/local-date";
import type { UserId } from "../../../../common/domain/user-id";
import { someInCauseChain } from "../../../../common/errors/find-in-cause-chain";
import type { Trip } from "../../domain/trip";
import type { PlanView } from "./planning-read.port";
import type { HomeBalancePort } from "./home-balance.port";
import type { HomeRecordsPort } from "./home-records.port";

export const HOME_READ_UNIT_OF_WORK = Symbol("HOME_READ_UNIT_OF_WORK");

/**
 * 旅行の参加者1人（recordのTripRosterEntryと同じ形。planningから
 * record・settlementの型を参照しないため、ここで宣言する）。
 */
export type HomeRosterEntry = Readonly<{
  slot: ParticipantSlot;
  userId: UserId;
  displayName: string;
}>;

/** ホームの最初に読む旅行と参加者の一覧。 */
export type HomeTripRow = Readonly<{
  trip: Trip;
  roster: readonly HomeRosterEntry[];
}>;

/**
 * ホームの旅行の照会。認可はSQLの条件で行う: actorが旅行の参加者
 * でなければnullを返す（参加していない・存在しない旅行は同じ扱い。
 * 存在を漏らさない）。この読み取りの失敗は欄の失敗ではなく、
 * ホーム全体の失敗になる。
 */
export interface HomeTripReadPort {
  find(tripId: string, actorId: UserId): Promise<HomeTripRow | null>;
}

/** 対象日の予定の照会（有効な達成・予約・履歴の有無を含む）。 */
export interface HomeScheduleReadPort {
  listForDay(tripId: string, date: LocalDate): Promise<PlanView[]>;
}

/** 欄の読み取り結果。失敗は例外ではなく`failed`の形で返す。 */
export type HomeSectionResult<T> =
  | { status: "ok"; data: T }
  | { status: "failed"; error: unknown };

export type HomeSectionName = "schedule" | "balance" | "recentRecords";

/**
 * ホームの読み取りを1つのトランザクションに束ねる文脈
 * （詳細設計「ホーム」）。REPEATABLE READ・READ ONLYの同じ
 * スナップショットから、旅行 → 予定の欄 → 精算の欄 → 最近の記録の
 * 順に読む。欄の読み取りは`runSection`でセーブポイントを挟んで順に
 * 実行し、同じ接続にクエリを並べて投げない。
 */
export interface HomeReadContext {
  trip: HomeTripReadPort;
  schedule: HomeScheduleReadPort;
  balance: HomeBalancePort;
  records: HomeRecordsPort;

  /**
   * 欄の読み取りを実行する。欄のクエリが回復できる誤りで失敗したら
   * `{ status: "failed" }`（欄は`unavailable`になる）。接続が切れた・
   * 認証の失敗など回復できない誤り（{@link isUnrecoverableHomeReadError}が
   * 真を返すもの）はそのまま投げ、ホーム全体の失敗にする。
   */
  runSection<T>(work: () => Promise<T>): Promise<HomeSectionResult<T>>;
}

export type HomeReadUnitOfWork = UnitOfWork<HomeReadContext>;

/**
 * 欄の失敗の記録。欄の名前と誤りの種類をwarnで残す（詳細設計
 * 「失敗・キャッシュ」）。実装はcompositionが組み立てて注入する。
 */
export interface HomeLog {
  warn(entry: Readonly<{ section: HomeSectionName; errorKind: string }>): void;
}

/** nodeレベルの接続誤り（接続が切れた・名前を引けない・到達できない）。 */
const NODE_CONNECTION_ERROR_CODES: ReadonlySet<string> = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EPIPE",
  "ENOTFOUND",
  "ENETUNREACH",
  "EAI_AGAIN",
]);

/**
 * 欄の読み取りのうち、セーブポイントへの巻き戻しでは回復できない誤り。
 * SQLSTATEの接続例外（クラス08）・認証系（クラス28）とnodeの接続誤りは
 * トランザクションごと使えないため、欄の`unavailable`ではなくホーム
 * 全体の失敗（503）にする（詳細設計「失敗・キャッシュ」）。
 * 直列化の失敗・デッドロック・lock_timeoutはここに含めない: まず
 * `ROLLBACK TO SAVEPOINT`を試し、戻れたならその欄を`unavailable`にする。
 */
export function isUnrecoverableHomeReadError(error: unknown): boolean {
  // drizzleはpgのエラーをDrizzleQueryErrorのcauseに包んで投げるため、
  // causeチェーンを辿ってSQLSTATE / errnoを見る。
  return someInCauseChain(error, (node) => {
    const code = (node as { code?: unknown }).code;
    return (
      typeof code === "string" &&
      (code.startsWith("08") ||
        code.startsWith("28") ||
        NODE_CONNECTION_ERROR_CODES.has(code))
    );
  });
}
