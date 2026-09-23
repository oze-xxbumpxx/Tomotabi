import { describe, expect, it } from "vitest";
import {
  ProbeCount,
  PROBE_COUNT_MAX,
} from "../../src/modules/foundation/domain/probe-count";

describe("ProbeCount", () => {
  it("allows zero", () => {
    expect(ProbeCount.create(0).value).toBe(0);
  });

  it("rejects a negative value", () => {
    expect(() => ProbeCount.create(-1)).toThrow(
      "ProbeCount must be a non-negative integer",
    );
  });

  it("rejects a non-integer", () => {
    expect(() => ProbeCount.create(1.5)).toThrow(
      "ProbeCount must be a non-negative integer",
    );
  });

  it("increments by one", () => {
    expect(ProbeCount.create(0).increment().value).toBe(1);
  });

  it("rejects a value above the maximum", () => {
    expect(() => ProbeCount.create(PROBE_COUNT_MAX + 1)).toThrow(
      "ProbeCount exceeds maximum",
    );
  });
});
