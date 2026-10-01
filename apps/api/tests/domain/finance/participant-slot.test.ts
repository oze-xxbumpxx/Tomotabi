import { describe, expect, it } from "vitest";
import { ParticipantSlot } from "../../../src/common/domain/participant-slot";

describe("ParticipantSlot", () => {
  it("0 と 1 だけを参加者番号として受け付ける", () => {
    expect(ParticipantSlot.parse(0)).toBe(0);
    expect(ParticipantSlot.parse(1)).toBe(1);
    for (const value of [-1, 2, 0.5, Number.NaN]) {
      expect(() => ParticipantSlot.parse(value)).toThrow();
    }
  });

  it("counterpart はもう一人の番号を返す", () => {
    expect(ParticipantSlot.counterpart(0)).toBe(1);
    expect(ParticipantSlot.counterpart(1)).toBe(0);
  });
});
