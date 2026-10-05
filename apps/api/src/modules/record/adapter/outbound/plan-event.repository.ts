import type {
  NewPlanEvent,
  NewPlanEventCancellation,
  PlanEvent,
  PlanEventCancellation,
  PlanEventKind,
} from "../../domain/plan-event";

/**
 * 達成・予約の記録の書き込み口
 * （record.plan_events・record.plan_event_cancellationsへの追記と、
 * record.active_plan_eventsの占有行の追加・削除）。
 * 履歴の表はappend-onlyで、この口からはUPDATEもDELETEもしない。
 */
export interface PlanEventRepository {
  /**
   * 予定・種類の有効な記録のid（active_plan_eventsの占有行）。
   * 無ければnull。
   */
  findActiveId(
    planId: string,
    kind: PlanEventKind,
  ): Promise<string | null>;

  /** 記録を履歴に足す（idはDBの既定値で振る）。 */
  insert(event: NewPlanEvent): Promise<PlanEvent>;

  /**
   * 有効な記録の占有行を足す。同じ予定・種類の行が先に入ったときは
   * 主キー(plan_id, event_kind)の一意違反（UseCaseが409に写す）。
   */
  insertActive(event: PlanEvent): Promise<void>;

  /**
   * 同じ旅行の記録を引く（取り消した記録も含むappend-only）。
   * 別の旅行の記録・無い記録はどちらもnull（どちらも同じ応答で、
   * 存在を漏らさない）。
   */
  findInTrip(tripId: string, eventId: string): Promise<PlanEvent | null>;

  /** 同じ旅行の記録の取り消しを引く。無ければnull。 */
  findCancellationInTrip(
    tripId: string,
    eventId: string,
  ): Promise<PlanEventCancellation | null>;

  /** 取り消しを履歴に足す（1記録1取消。event_idが主キー）。 */
  insertCancellation(
    cancellation: NewPlanEventCancellation,
  ): Promise<PlanEventCancellation>;

  /**
   * 対象の記録の占有行だけを消す。event_idで消す
   * （planIdと種類で消すと、付け直した新しい記録まで消してしまう）。
   */
  deleteActive(eventId: string): Promise<void>;
}
