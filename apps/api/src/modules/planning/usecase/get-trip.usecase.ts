import type { Trip } from "@tomotabi/contracts";
import type { GetTripInput, GetTripInputPort } from "../adapter/inbound/get-trip.input-port.js";
import type { PlanningReadPort } from "../adapter/outbound/planning-read.port.js";
import { toTripDto } from "./trip-dto.js";
import { tripNotAccessible } from "./trip-write-flow.js";

export class GetTripUseCase implements GetTripInputPort {
  constructor(private readonly read: PlanningReadPort) {}

  async execute(input: GetTripInput): Promise<Trip> {
    const trip = await this.read.findTripForParticipant(
      input.tripId,
      input.userId,
    );
    if (trip === null) {
      throw tripNotAccessible();
    }
    return toTripDto(trip);
  }
}
