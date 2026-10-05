import type { UserId } from "../../../../common/domain/user-id";
import type { IdempotencyKey } from "../../../../common/http/idempotency-key";
import type { PlanEventKind } from "../../domain/plan-event";
import type { PlanEventWriteResult } from "./plan-event-write.result";

export const CREATE_PLAN_EVENT_INPUT_PORT = Symbol(
  "CREATE_PLAN_EVENT_INPUT_PORT",
);

/**
 * URLの記録の種類からreceiptの操作名を引く（achievementsの作成は
 * createAchievement、bookingsの作成はcreateBooking。契約のoperationId）。
 */
export function createPlanEventOperation(
  kind: PlanEventKind,
): "createAchievement" | "createBooking" {
  return kind === "achievement" ? "createAchievement" : "createBooking";
}

export type CreatePlanEventInput = Readonly<{
  userId: UserId;
  tripId: string;
  /** URLの種類（/achievementsはachievement、/bookingsはbooking） */
  eventKind: PlanEventKind;
  planId: string;
  key: IdempotencyKey;
  requestHash: string;
}>;

export interface CreatePlanEventInputPort {
  execute(input: CreatePlanEventInput): Promise<PlanEventWriteResult>;
}
