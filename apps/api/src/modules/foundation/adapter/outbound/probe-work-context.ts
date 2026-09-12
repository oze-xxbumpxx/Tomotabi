import type { ProbeRepository } from "./probe.repository";

export interface ProbeWorkContext {
  probes: ProbeRepository;
}

export const FOUNDATION_UNIT_OF_WORK = Symbol("FOUNDATION_UNIT_OF_WORK");
