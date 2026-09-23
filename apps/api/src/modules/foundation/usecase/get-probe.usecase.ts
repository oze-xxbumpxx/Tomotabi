import type { ProbeView } from "@tomotabi/contracts";
import type { GetProbeInputPort } from "../adapter/inbound/get-probe.input-port";
import type { ProbeRepository } from "../adapter/outbound/probe.repository";

export class GetProbeUseCase implements GetProbeInputPort {
  constructor(private readonly probes: ProbeRepository) {}

  async execute(): Promise<ProbeView> {
    const current = await this.probes.getCount();
    return { count: current.value };
  }
}
