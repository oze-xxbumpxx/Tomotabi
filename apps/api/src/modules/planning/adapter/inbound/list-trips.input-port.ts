import type { TripPage, TripStatus } from "@tomotabi/contracts";
import type { UserId } from "../../../../common/domain/user-id";

export const LIST_TRIPS_INPUT_PORT = Symbol("LIST_TRIPS_INPUT_PORT");

export type ListTripsInput = Readonly<{
  userId: UserId;
  status: TripStatus | null;
  /** 改ざん・形式違反のカーソルは渡さない（UseCaseが400にする） */
  cursor: string | null;
  limit: number;
}>;

export interface ListTripsInputPort {
  execute(input: ListTripsInput): Promise<TripPage>;
}
