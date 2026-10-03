import type { EventKind } from "@tomotabi/contracts";
import type { UserId } from "../../../../common/domain/user-id";

/**
 * 有効な達成・予約1件。active_plan_eventsで「有効」な行に対応する。
 * eventKindは'achievement' | 'booking'（取り消しはここには来ない）。
 */
export type ActivePlanEvent = Readonly<{
  id: string;
  tripId: string;
  planId: string;
  kind: EventKind;
  createdBy: UserId;
  createdAt: Date;
}>;

/**
 * 予定に対するrecordの公開照会。recordモジュールが実装する。
 * 「履歴がある」は取り消し済みも含むplan_eventsの存在で判定する（詳細設計04 §6備考3）。
 */
export interface RecordHistoryPort {
  /** 達成・予約の履歴（取り消し済みを含む）が一度でもあるか。 */
  hasHistory(planId: string): Promise<boolean>;
  /** 有効な達成・予約を返す。無い方はnull。取り消し済みは返さない。 */
  activeEvents(
    planId: string,
  ): Promise<{ achievement: ActivePlanEvent | null; booking: ActivePlanEvent | null }>;
}

/**
 * tx内のdbハンドルからRecordHistoryPortを作るファクトリ。
 * dbはpgのトランザクション。型を漏らさないためunknownで受ける。
 */
export type RecordHistoryFactory = (db: unknown) => RecordHistoryPort;
export const RECORD_HISTORY_FACTORY = Symbol("RECORD_HISTORY_FACTORY");
