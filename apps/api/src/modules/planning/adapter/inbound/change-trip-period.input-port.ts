import type { UserId } from "../../../../common/domain/user-id";
import type { IdempotencyKey } from "../../../../common/http/idempotency-key";
import type { TripWriteResult } from "./trip-write.result";

export const CHANGE_TRIP_PERIOD_INPUT_PORT = Symbol(
  "CHANGE_TRIP_PERIOD_INPUT_PORT",
);
export const CHANGE_TRIP_PERIOD_OPERATION = "updateTripPeriod";

export type ChangeTripPeriodInput = Readonly<{
  userId: UserId;
  tripId: string;
  key: IdempotencyKey;
  ifMatch: string;
  requestHash: string;
  startsOn: string;
  endsOn: string;
}>;

export interface ChangeTripPeriodInputPort {
  execute(input: ChangeTripPeriodInput): Promise<TripWriteResult>;
}
