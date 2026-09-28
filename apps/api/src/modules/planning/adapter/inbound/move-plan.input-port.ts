import type { UserId } from "../../../../common/domain/user-id";
import type { IdempotencyKey } from "../../../../common/http/idempotency-key";
import type { PlanWriteResult } from "./plan-write.result";

export const MOVE_PLAN_INPUT_PORT = Symbol("MOVE_PLAN_INPUT_PORT");
export const MOVE_PLAN_OPERATION = "movePlan";

export type MovePlanInput = Readonly<{
  userId: UserId;
  tripId: string;
  planId: string;
  key: IdempotencyKey;
  ifMatch: string;
  requestHash: string;
  date: string;
}>;

export interface MovePlanInputPort {
  /**
   * @throws 旅行が無い・参加していないとき 403 TRIP_NOT_ACCESSIBLE、
   *   予定が無いとき 404 PLAN_NOT_FOUND、移動先が期間外のとき
   *   422 PLAN_OUTSIDE_TRIP_PERIOD。
   */
  execute(input: MovePlanInput): Promise<PlanWriteResult>;
}
