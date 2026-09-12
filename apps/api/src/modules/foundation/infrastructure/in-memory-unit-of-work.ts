import type { UnitOfWork } from "../../../adapter/transaction/unit-of-work";
import type { ProbeWorkContext } from "../adapter/outbound/probe-work-context";
import { InMemoryProbeRepository } from "./in-memory-probe.repository";
import type { InMemoryProbeStore } from "./in-memory-probe.store";

export class InMemoryUnitOfWork implements UnitOfWork<ProbeWorkContext> {
  constructor(private readonly store: InMemoryProbeStore) {}

  async run<T>(work: (ctx: ProbeWorkContext) => Promise<T>): Promise<T> {
    return work({
      probes: new InMemoryProbeRepository(this.store),
    });
  }
}
