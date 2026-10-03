import type { UserId } from "../../../../common/domain/user-id";
import type { IdempotencyKey } from "../../../../common/http/idempotency-key";
import type { PlanWriteResult } from "./plan-write.result";

export const CREATE_PLAN_INPUT_PORT = Symbol("CREATE_PLAN_INPUT_PORT");
export const CREATE_PLAN_OPERATION = "createPlan";

export type CreatePlanInput = Readonly<{
  userId: UserId;
  tripId: string;
  key: IdempotencyKey;
  requestHash: string;
  name: string;
  kind: string;
  date: string;
  /** `HH:mm`またはnull。 */
  time: string | null;
  memo: string | null;
}>;

export interface CreatePlanInputPort {
  /**
   * @throws旅行が無い・参加していないとき403 TRIP_NOT_ACCESSIBLE。
   *   日付が期間外のとき422 PLAN_OUTSIDE_TRIP_PERIOD。
   */
  execute(input: CreatePlanInput): Promise<PlanWriteResult>;
}
