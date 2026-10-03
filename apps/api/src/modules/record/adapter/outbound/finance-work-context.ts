import type { UnitOfWork } from "../../../../adapter/transaction/unit-of-work";
import type { ParticipantSlot } from "../../../../common/domain/participant-slot";
import type { UserId } from "../../../../common/domain/user-id";
import type { CommandReceiptStore } from "../../../planning/adapter/outbound/planning-work-context";
import type { PaymentRepository } from "./payment.repository";

export const FINANCE_UNIT_OF_WORK = Symbol("FINANCE_UNIT_OF_WORK");

/**
 * 旅行の参加者 1 人。参加者番号（0・1）と利用者の対応。
 * displayName は残額・確認の向き表示に使う（identity.users の name）。
 */
export type TripRosterEntry = Readonly<{
  slot: ParticipantSlot;
  userId: UserId;
  displayName: string;
}>;

/**
 * 旅行の参加者の照会。認可は SQL の条件で行う（actor が参加する旅行の
 * 参加者だけを返す）。財務の書き込みの最初の確認に使う。
 */
export interface TripRosterPort {
  /**
   * actor が参加する旅行の参加者を参加者番号順で返す。
   * 参加していない・存在しない旅行は null（どちらも同じ扱い。存在を漏らさない）。
   */
  find(tripId: string, actorId: UserId): Promise<readonly TripRosterEntry[] | null>;
}

/**
 * infra.trip_finance_guards の行ロック（旅行の財務の「順番待ちの札」）。
 * お金の書き込みは最初にこの行を取るので、同じ旅行の書き込みは一列に並ぶ。
 */
export interface FinanceGuardLocker {
  /**
   * 旅行の guard 行を SELECT … FOR UPDATE でロックする。
   * 参加者の確認のあと・receipt の照会の前に呼ぶ（設計書「書き込みの共通の流れ」）。
   */
  lock(tripId: string): Promise<void>;
}

/**
 * 同じ旅行の予定かの照会。関連する予定に別の旅行の予定を混ぜられない
 * ようにする（複合 FK と合わせてサーバー側でも検証する）。
 */
export interface TripPlansPort {
  existsInTrip(tripId: string, planId: string): Promise<boolean>;
}

/**
 * 財務の UseCase に渡す文脈。型付きの照会・Repository・receipt の
 * 限定集合で、生の tx や SQL 実行口は渡さない（設計書「UnitOfWork の文脈」）。
 * 支払い（record）・確認と精算（settlement）の書き込みが同じ文脈を使う。
 */
export interface FinanceWorkContext {
  roster: TripRosterPort;
  financeGuard: FinanceGuardLocker;
  receipts: CommandReceiptStore;
  payments: PaymentRepository;
  plans: TripPlansPort;
}

export type FinanceUnitOfWork = UnitOfWork<FinanceWorkContext>;
