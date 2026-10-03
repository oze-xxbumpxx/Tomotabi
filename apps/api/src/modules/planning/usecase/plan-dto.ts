import type { Plan as PlanContract, PlanEvent } from "@tomotabi/contracts";
import type { Plan } from "../domain/plan";
import type { ActivePlanEvent } from "../adapter/outbound/record-history.port";

function toPlanEventDto(event: ActivePlanEvent | null): PlanEvent | null {
  if (event === null) {
    return null;
  }
  return {
    id: event.id,
    tripId: event.tripId,
    planId: event.planId,
    kind: event.kind,
    createdBy: event.createdBy,
    createdAt: event.createdAt.toISOString(),
    // 有効な行しか結合しないので、ここで返すものは常に取り消し無し。
    cancellation: null,
  };
}

/**
 * Domainの予定を公開契約の形にする。versionは10進の文字列（ETagの中身）。
 * canChangeKind / kindChangeReasonは画面の目安で、書き込み時に再度確かめる。
 */
export function toPlanDto(
  plan: Plan,
  extra: Readonly<{
    achievement: ActivePlanEvent | null;
    booking: ActivePlanEvent | null;
    hasRecordHistory: boolean;
  }>,
): PlanContract {
  return {
    id: plan.id,
    tripId: plan.tripId,
    name: plan.name,
    kind: plan.kind,
    date: plan.date,
    time: plan.time,
    memo: plan.memo,
    cancelledAt:
      plan.cancelledAt === null ? null : plan.cancelledAt.toISOString(),
    cancelledBy: plan.cancelledBy,
    version: String(plan.version),
    achievement: toPlanEventDto(extra.achievement),
    booking: toPlanEventDto(extra.booking),
    canChangeKind: !extra.hasRecordHistory,
    kindChangeReason: extra.hasRecordHistory
      ? "record_history_exists"
      : null,
  };
}
