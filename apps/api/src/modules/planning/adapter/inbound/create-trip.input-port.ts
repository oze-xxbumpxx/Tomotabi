import type { UserId } from "../../../../common/domain/user-id.js";
import type { IdempotencyKey } from "../../../../common/http/idempotency-key.js";
import type { TripWriteResult } from "./trip-write.result.js";

export const CREATE_TRIP_INPUT_PORT = Symbol("CREATE_TRIP_INPUT_PORT");
export const CREATE_TRIP_OPERATION = "createTrip";

export type CreateTripInput = Readonly<{
  userId: UserId;
  key: IdempotencyKey;
  requestHash: string;
  name: string;
  startsOn: string;
  endsOn: string;
}>;

export interface CreateTripInputPort {
  execute(input: CreateTripInput): Promise<TripWriteResult>;
}
