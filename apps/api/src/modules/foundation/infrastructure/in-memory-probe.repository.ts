import type { ProbeRepository } from "../adapter/outbound/probe.repository.js";
import type { ProbeCount } from "../domain/probe-count.js";
import type { InMemoryProbeStore } from "./in-memory-probe.store.js";

export class InMemoryProbeRepository implements ProbeRepository {
  constructor(private readonly store: InMemoryProbeStore) {}

  async getCount(): Promise<ProbeCount> {
    return this.store.get();
  }

  async save(count: ProbeCount): Promise<void> {
    this.store.set(count);
  }
}
