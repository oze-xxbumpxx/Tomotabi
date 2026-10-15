import type { IncrementProbePort } from "../adapter/service/increment-probe.port.js";
import { ProbeCount, PROBE_COUNT_MAX } from "../domain/probe-count.js";

export class IncrementProbeService implements IncrementProbePort {
  increment(current: ProbeCount, step = 1): ProbeCount {
    if (!Number.isInteger(step) || step < 1) {
      throw new Error("step must be a positive integer");
    }
    if (current.value + step > PROBE_COUNT_MAX) {
      throw new Error("ProbeCount exceeds maximum");
    }
    return ProbeCount.create(current.value + step);
  }
}
