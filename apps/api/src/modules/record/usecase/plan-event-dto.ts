import type {
  Cancellation,
  PlanEvent as PlanEventContract,
} from "@tomotabi/contracts";
import type { PlanEvent, PlanEventCancellation } from "../domain/plan-event";

/**
 * Domainの記録を公開契約の形にする。付けた直後の記録に取り消しは
 * 付かないためcancellationは常にnull。
 */
export function toPlanEventDto(event: PlanEvent): PlanEventContract {
  return {
    id: event.id,
    tripId: event.tripId,
    planId: event.planId,
    kind: event.kind,
    createdBy: event.createdBy,
    createdAt: event.createdAt.toISOString(),
    cancellation: null,
  };
}

export function toPlanEventCancellationDto(
  cancellation: PlanEventCancellation,
): Cancellation {
  return {
    targetId: cancellation.eventId,
    cancelledBy: cancellation.cancelledBy,
    createdAt: cancellation.createdAt.toISOString(),
  };
}
