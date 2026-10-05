import type { UserId } from "../../../../common/domain/user-id";
import type { IdempotencyKey } from "../../../../common/http/idempotency-key";
import type { PlanEventKind } from "../../domain/plan-event";
import type { PlanEventCancellationResult } from "./plan-event-write.result";

export const CANCEL_PLAN_EVENT_INPUT_PORT = Symbol(
  "CANCEL_PLAN_EVENT_INPUT_PORT",
);

/**
 * URLの記録の種類からreceiptの操作名を引く（achievementsの取り消しは
 * cancelAchievement、bookingsの取り消しはcancelBooking。契約のoperationId）。
 */
export function cancelPlanEventOperation(
  kind: PlanEventKind,
): "cancelAchievement" | "cancelBooking" {
  return kind === "achievement" ? "cancelAchievement" : "cancelBooking";
}

export type CancelPlanEventInput = Readonly<{
  userId: UserId;
  tripId: string;
  /** URLの種類（/achievementsはachievement、/bookingsはbooking） */
  eventKind: PlanEventKind;
  recordId: string;
  key: IdempotencyKey;
  requestHash: string;
}>;

export interface CancelPlanEventInputPort {
  execute(input: CancelPlanEventInput): Promise<PlanEventCancellationResult>;
}
