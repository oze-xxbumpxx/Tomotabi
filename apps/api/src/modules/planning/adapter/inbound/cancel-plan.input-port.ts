import type { UserId } from "../../../../common/domain/user-id";
import type { IdempotencyKey } from "../../../../common/http/idempotency-key";
import type { PlanWriteResult } from "./plan-write.result";

export const CANCEL_PLAN_INPUT_PORT = Symbol("CANCEL_PLAN_INPUT_PORT");
export const CANCEL_PLAN_OPERATION = "cancelPlan";

export type CancelPlanInput = Readonly<{
  userId: UserId;
  tripId: string;
  planId: string;
  key: IdempotencyKey;
  ifMatch: string;
  requestHash: string;
}>;

export interface CancelPlanInputPort {
  /**
   * @throws旅行が無い・参加していないとき403 TRIP_NOT_ACCESSIBLE、
   *   予定が無いとき404 PLAN_NOT_FOUND、取りやめ済みの再取りやめは
   *   409 PLAN_CANCELLED。
   */
  execute(input: CancelPlanInput): Promise<PlanWriteResult>;
}
