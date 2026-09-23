export const PROBE_COUNT_MAX = 1_000_000;

export class ProbeCount {
  private constructor(readonly value: number) {}

  static create(value: number): ProbeCount {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error("ProbeCount must be a non-negative integer");
    }
    if (value > PROBE_COUNT_MAX) {
      throw new Error("ProbeCount exceeds maximum");
    }
    return new ProbeCount(value);
  }

  increment(): ProbeCount {
    return ProbeCount.create(this.value + 1);
  }
}
