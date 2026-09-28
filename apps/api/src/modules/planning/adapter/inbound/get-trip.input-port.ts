import type { Trip } from "@tomotabi/contracts";
import type { UserId } from "../../../../common/domain/user-id";

export const GET_TRIP_INPUT_PORT = Symbol("GET_TRIP_INPUT_PORT");

export type GetTripInput = Readonly<{
  userId: UserId;
  tripId: string;
}>;

export interface GetTripInputPort {
  /**
   * @throws 旅行が無い・参加していないとき 403 TRIP_NOT_ACCESSIBLE（どちらも同じ応答）。
   */
  execute(input: GetTripInput): Promise<Trip>;
}
