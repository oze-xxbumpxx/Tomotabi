import type { Plan as PlanContract } from "@tomotabi/contracts";
import type {
  GetPlanInput,
  GetPlanInputPort,
} from "../adapter/inbound/get-plan.input-port.js";
import type { PlanningReadPort } from "../adapter/outbound/planning-read.port.js";
import { toPlanDto } from "./plan-dto.js";
import { planNotFound } from "./plan-write-flow.js";
import { tripNotAccessible } from "./trip-write-flow.js";

export class GetPlanUseCase implements GetPlanInputPort {
  constructor(private readonly read: PlanningReadPort) {}

  async execute(input: GetPlanInput): Promise<PlanContract> {
    const trip = await this.read.findTripForParticipant(
      input.tripId,
      input.userId,
    );
    if (trip === null) {
      throw tripNotAccessible();
    }
    const view = await this.read.findPlanInTrip(input.tripId, input.planId);
    if (view === null) {
      throw planNotFound();
    }
    return toPlanDto(view.plan, view);
  }
}
