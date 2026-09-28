import type { Plan } from "@tomotabi/contracts";
import type { UserId } from "../../../../common/domain/user-id";

export const GET_PLAN_INPUT_PORT = Symbol("GET_PLAN_INPUT_PORT");

export type GetPlanInput = Readonly<{
  userId: UserId;
  tripId: string;
  planId: string;
}>;

export interface GetPlanInputPort {
  /**
   * @throws 旅行が無い・参加していないとき 403 TRIP_NOT_ACCESSIBLE。
   *   予定が無い・別の旅行の予定のとき 404 PLAN_NOT_FOUND。
   */
  execute(input: GetPlanInput): Promise<Plan>;
}
