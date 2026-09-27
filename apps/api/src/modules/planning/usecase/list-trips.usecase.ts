import type { TripPage } from "@tomotabi/contracts";
import {
  type ListTripsInput,
  type ListTripsInputPort,
} from "../adapter/inbound/list-trips.input-port";
import type { PlanningReadPort } from "../adapter/outbound/planning-read.port";
import { decodeTripCursor, encodeTripCursor } from "./trip-cursor";
import { toTripDto } from "./trip-dto";

export class ListTripsUseCase implements ListTripsInputPort {
  constructor(private readonly read: PlanningReadPort) {}

  async execute(input: ListTripsInput): Promise<TripPage> {
    const after = input.cursor === null ? null : decodeTripCursor(input.cursor);
    const page = await this.read.listTripsForParticipant(input.userId, {
      status: input.status,
      after,
      limit: input.limit,
    });
    return {
      items: page.items.map(toTripDto),
      nextCursor:
        page.nextCursor === null ? null : encodeTripCursor(page.nextCursor),
    };
  }
}
