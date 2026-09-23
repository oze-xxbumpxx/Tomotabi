import type { ProbeView } from "@tomotabi/contracts";

export const INCREMENT_PROBE_INPUT_PORT = Symbol("INCREMENT_PROBE_INPUT_PORT");

export interface IncrementProbeInputPort {
  execute(): Promise<ProbeView>;
}
