import type { Plan as PlanContract } from "@tomotabi/contracts";
import type {
  GetPlanInput,
  GetPlanInputPort,
} from "../adapter/inbound/get-plan.input-port";
import type { PlanningReadPort } from "../adapter/outbound/planning-read.port";
import { toPlanDto } from "./plan-dto";
import { planNotFound } from "./plan-write-flow";
import { tripNotAccessible } from "./trip-write-flow";

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
