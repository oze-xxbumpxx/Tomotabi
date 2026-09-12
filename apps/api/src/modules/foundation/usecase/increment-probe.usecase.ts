import type { ProbeView } from "@tomotabi/contracts";
import type { UnitOfWork } from "../../../adapter/transaction/unit-of-work";
import type { IncrementProbeInputPort } from "../adapter/inbound/increment-probe.input-port";
import type { ProbeWorkContext } from "../adapter/outbound/probe-work-context";
import type { IncrementProbePort } from "../adapter/service/increment-probe.port";

export class IncrementProbeUseCase implements IncrementProbeInputPort {
  constructor(
    private readonly unitOfWork: UnitOfWork<ProbeWorkContext>,
    private readonly incrementProbe: IncrementProbePort,
  ) {}

  execute(): Promise<ProbeView> {
    return this.unitOfWork.run(async (ctx) => {
      const current = await ctx.probes.getCount();
      const next = this.incrementProbe.increment(current);
      await ctx.probes.save(next);
      return { count: next.value };
    });
  }
}
