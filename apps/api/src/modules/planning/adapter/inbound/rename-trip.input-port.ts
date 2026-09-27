import type { UserId } from "../../../../common/domain/user-id";
import type { IdempotencyKey } from "../../../../common/http/idempotency-key";
import type { TripWriteResult } from "./trip-write.result";

export const RENAME_TRIP_INPUT_PORT = Symbol("RENAME_TRIP_INPUT_PORT");
export const RENAME_TRIP_OPERATION = "renameTrip";

export type RenameTripInput = Readonly<{
  userId: UserId;
  tripId: string;
  key: IdempotencyKey;
  ifMatch: string;
  requestHash: string;
  name: string;
}>;

export interface RenameTripInputPort {
  execute(input: RenameTripInput): Promise<TripWriteResult>;
}
