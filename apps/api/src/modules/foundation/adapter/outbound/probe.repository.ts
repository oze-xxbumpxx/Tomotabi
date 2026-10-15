import type { ProbeCount } from "../../domain/probe-count.js";

export const PROBE_REPOSITORY = Symbol("PROBE_REPOSITORY");

export interface ProbeRepository {
  getCount(): Promise<ProbeCount>;
  save(count: ProbeCount): Promise<void>;
}
