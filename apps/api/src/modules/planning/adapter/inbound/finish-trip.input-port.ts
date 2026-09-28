import type { UserId } from "../../../../common/domain/user-id";
import type { IdempotencyKey } from "../../../../common/http/idempotency-key";
import type { TripWriteResult } from "./trip-write.result";

export const FINISH_TRIP_INPUT_PORT = Symbol("FINISH_TRIP_INPUT_PORT");
export const FINISH_TRIP_OPERATION = "finishTrip";

export type FinishTripInput = Readonly<{
  userId: UserId;
  tripId: string;
  key: IdempotencyKey;
  ifMatch: string;
  requestHash: string;
}>;

export interface FinishTripInputPort {
  execute(input: FinishTripInput): Promise<TripWriteResult>;
}
