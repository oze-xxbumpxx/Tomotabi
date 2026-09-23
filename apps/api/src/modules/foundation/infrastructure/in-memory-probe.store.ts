import { ProbeCount } from "../domain/probe-count";

export class InMemoryProbeStore {
  constructor(private count: ProbeCount = ProbeCount.create(0)) {}

  get(): ProbeCount {
    return this.count;
  }

  set(count: ProbeCount): void {
    this.count = count;
  }
}
