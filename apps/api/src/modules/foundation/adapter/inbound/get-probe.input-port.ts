import type { ProbeView } from "@tomotabi/contracts";

export const GET_PROBE_INPUT_PORT = Symbol("GET_PROBE_INPUT_PORT");

export interface GetProbeInputPort {
  execute(): Promise<ProbeView>;
}
