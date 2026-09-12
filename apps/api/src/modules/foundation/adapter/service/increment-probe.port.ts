import type { ProbeCount } from "../../domain/probe-count";

export const INCREMENT_PROBE_PORT = Symbol("INCREMENT_PROBE_PORT");

export interface IncrementProbePort {
  increment(current: ProbeCount, step?: number): ProbeCount;
}
