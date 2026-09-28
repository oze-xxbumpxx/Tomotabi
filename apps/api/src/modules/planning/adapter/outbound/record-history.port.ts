import type { EventKind } from "@tomotabi/contracts";
import type { UserId } from "../../../../common/domain/user-id";

/**
 * 有効な達成・予約 1 件。active_plan_events で「有効」な行に対応する。
 * eventKind は 'achievement' | 'booking'（取り消しはここには来ない）。
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
 * 予定に対する record の公開照会。record モジュールが実装する。
 * 「履歴がある」は取り消し済みも含む plan_events の存在で判定する（詳細設計 04 §6 備考3）。
 */
export interface RecordHistoryPort {
  /** 達成・予約の履歴（取り消し済みを含む）が一度でもあるか。 */
  hasHistory(planId: string): Promise<boolean>;
  /** 有効な達成・予約を返す。無い方は null。取り消し済みは返さない。 */
  activeEvents(
    planId: string,
  ): Promise<{ achievement: ActivePlanEvent | null; booking: ActivePlanEvent | null }>;
}

/**
 * tx 内の db ハンドルから RecordHistoryPort を作るファクトリ。
 * db は pg のトランザクション。型を漏らさないため unknown で受ける。
 */
export type RecordHistoryFactory = (db: unknown) => RecordHistoryPort;
export const RECORD_HISTORY_FACTORY = Symbol("RECORD_HISTORY_FACTORY");
