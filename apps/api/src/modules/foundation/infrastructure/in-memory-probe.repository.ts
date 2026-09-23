import type { ProbeRepository } from "../adapter/outbound/probe.repository";
import type { ProbeCount } from "../domain/probe-count";
import type { InMemoryProbeStore } from "./in-memory-probe.store";

export class InMemoryProbeRepository implements ProbeRepository {
  constructor(private readonly store: InMemoryProbeStore) {}

  async getCount(): Promise<ProbeCount> {
    return this.store.get();
  }

  async save(count: ProbeCount): Promise<void> {
    this.store.set(count);
  }
}
