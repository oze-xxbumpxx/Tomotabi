import type { Itinerary } from "@tomotabi/contracts";
import type { UserId } from "../../../../common/domain/user-id";

export const GET_ITINERARY_INPUT_PORT = Symbol("GET_ITINERARY_INPUT_PORT");

export type GetItineraryInput = Readonly<{
  userId: UserId;
  tripId: string;
  /** `YYYY-MM-DD`。省略時は null。 */
  date: string | null;
}>;

export interface GetItineraryInputPort {
  /**
   * @throws 旅行が無い・参加していないとき 403 TRIP_NOT_ACCESSIBLE。
   *   明示した日付が期間外・実在しないとき 422。
   */
  execute(input: GetItineraryInput): Promise<Itinerary>;
}
