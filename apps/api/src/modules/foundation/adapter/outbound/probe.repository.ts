import type { ProbeCount } from "../../domain/probe-count";

export const PROBE_REPOSITORY = Symbol("PROBE_REPOSITORY");

export interface ProbeRepository {
  getCount(): Promise<ProbeCount>;
  save(count: ProbeCount): Promise<void>;
}
