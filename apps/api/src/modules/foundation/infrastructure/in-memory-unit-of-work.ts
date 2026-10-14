import type { UnitOfWork } from "../../../adapter/transaction/unit-of-work.js";
import type { ProbeWorkContext } from "../adapter/outbound/probe-work-context.js";
import { InMemoryProbeRepository } from "./in-memory-probe.repository.js";
import type { InMemoryProbeStore } from "./in-memory-probe.store.js";

export class InMemoryUnitOfWork implements UnitOfWork<ProbeWorkContext> {
  constructor(private readonly store: InMemoryProbeStore) {}

  async run<T>(work: (ctx: ProbeWorkContext) => Promise<T>): Promise<T> {
    return work({
      probes: new InMemoryProbeRepository(this.store),
    });
  }
}
