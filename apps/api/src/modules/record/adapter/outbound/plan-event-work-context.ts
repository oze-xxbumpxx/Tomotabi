import type { UnitOfWork } from "../../../../adapter/transaction/unit-of-work";
import type { UserId } from "../../../../common/domain/user-id";
import type { CommandReceiptStore } from "../../../planning/adapter/outbound/planning-work-context";
import type { PlanEligibilityPort } from "./plan-eligibility.port";
import type { PlanEventRepository } from "./plan-event.repository";

export const PLAN_EVENT_UNIT_OF_WORK = Symbol("PLAN_EVENT_UNIT_OF_WORK");

/**
 * 記録の書き込みの最初の確認に使う、参加している旅行の行のロック。
 * 予定の書き込みと同じく旅行の行をFOR SHAREで取る（お金の順番待ちの
 * 行ロックとは別系統で、達成・予約はそちらは取らない）。
 */
export interface TripShareLockPort {
  /**
   * actorが参加する旅行の行をFOR SHAREで取る。参加していない・
   * 存在しない旅行はnull（どちらも同じ扱い。存在を漏らさない）。
   */
  lockForShare(
    tripId: string,
    actorId: UserId,
  ): Promise<Readonly<{ id: string }> | null>;
}

/**
 * 達成・予約の書き込みの文脈。型付きの照会・Repository・receiptの
 * 限定集合で、生のtxやSQL実行口は渡さない（設計書「UnitOfWorkの文脈」）。
 * ロックは旅行（FOR SHARE）→ 予定（FOR NO KEY UPDATE）の順で、
 * 予定の書き込みと同じ順序にそろえる。
 */
export interface PlanEventWorkContext {
  trips: TripShareLockPort;
  receipts: CommandReceiptStore;
  planEligibility: PlanEligibilityPort;
  planEvents: PlanEventRepository;
}

export type PlanEventUnitOfWork = UnitOfWork<PlanEventWorkContext>;
