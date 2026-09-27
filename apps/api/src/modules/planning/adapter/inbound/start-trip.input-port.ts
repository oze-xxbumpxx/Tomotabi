import type { UserId } from "../../../../common/domain/user-id";
import type { IdempotencyKey } from "../../../../common/http/idempotency-key";
import type { TripWriteResult } from "./trip-write.result";

export const START_TRIP_INPUT_PORT = Symbol("START_TRIP_INPUT_PORT");
export const START_TRIP_OPERATION = "startTrip";

export type StartTripInput = Readonly<{
  userId: UserId;
  tripId: string;
  key: IdempotencyKey;
  ifMatch: string;
  requestHash: string;
}>;

export interface StartTripInputPort {
  execute(input: StartTripInput): Promise<TripWriteResult>;
}
