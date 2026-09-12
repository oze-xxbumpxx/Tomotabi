import { describe, expect, it } from "vitest";
import { ProbeCount, PROBE_COUNT_MAX } from "../../src/modules/foundation/domain/probe-count";
import { IncrementProbeService } from "../../src/modules/foundation/service/increment-probe.service";

describe("IncrementProbeService", () => {
  const service = new IncrementProbeService();

  it("adds one by default", () => {
    expect(service.increment(ProbeCount.create(0)).value).toBe(1);
  });

  it("rejects a non-positive step", () => {
    expect(() => service.increment(ProbeCount.create(0), 0)).toThrow(
      "step must be a positive integer",
    );
  });

  it("rejects an increment that would exceed the maximum", () => {
    expect(() => service.increment(ProbeCount.create(PROBE_COUNT_MAX))).toThrow(
      "ProbeCount exceeds maximum",
    );
  });
});
