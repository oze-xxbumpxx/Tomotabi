import type { UserId } from "../../../common/domain/user-id";
import { PlanKind } from "../../planning/domain/plan-kind";

/**
 * 予定につける記録の種類（record.plan_events.event_kind）。
 * 達成は行った証し、予約は外で押さえた席・部屋・便の記録。
 */
export type PlanEventKind = "achievement" | "booking";

/**
 * 達成・予約の記録1件（record.plan_events）。append-onlyで、
 * 取り消されても行は残る（有効かどうかはactive_plan_eventsの占有行で見る）。
 */
export type PlanEvent = Readonly<{
  id: string;
  tripId: string;
  planId: string;
  kind: PlanEventKind;
  createdBy: UserId;
  createdAt: Date;
}>;

export type NewPlanEvent = Omit<PlanEvent, "id" | "createdAt">;

/**
 * 記録の取り消し（record.plan_event_cancellations）。1記録1取消
 * （event_idがPK）。元の記録の行は残る。
 */
export type PlanEventCancellation = Readonly<{
  eventId: string;
  tripId: string;
  cancelledBy: UserId;
  createdAt: Date;
}>;

export type NewPlanEventCancellation = Omit<PlanEventCancellation, "createdAt">;

/** 記録を付けられない理由（UseCaseが応答codeに写す）。 */
export type PlanEventRejection = "kind_not_supported" | "plan_cancelled";

/**
 * 予定がその種類の記録を付けられる状態かの決まり（設計書「達成・予約の記録」）。
 * - 達成は場所・食べ処・買い物の予定に付けられる。取りやめた予定には付けられない
 * - 予約は食べ処・宿・移動の予定に付けられる。取りやめた予定にも付けられる
 * 付けられるときnull、付けられないとき理由を返す。
 */
export function planEventRejection(
  kind: PlanEventKind,
  plan: Readonly<{ kind: PlanKind; cancelledAt: Date | null }>,
): PlanEventRejection | null {
  const supported =
    kind === "achievement"
      ? PlanKind.supportsAchievement(plan.kind)
      : PlanKind.supportsBooking(plan.kind);
  if (!supported) {
    return "kind_not_supported";
  }
  if (kind === "achievement" && plan.cancelledAt !== null) {
    return "plan_cancelled";
  }
  return null;
}
