import { describe, expect, it } from "vitest";
import { LocalTime } from "../../src/common/domain/local-time";

describe("LocalTime", () => {
  it.each([
    ["00:00", true],
    ["23:59", true],
    ["09:00", true],
    ["24:00", false],
    ["12:30:00", false],
    ["9:00", false],
    // DB の time(0) は秒・秒の端数を丸めるため、API の境界が唯一の守り（PR #70 の指摘）
    ["09:00:00", false],
    ["09:00:00.4", false],
    ["23:60", false],
    ["", false],
  ])("U-06: %s は HH:mm として%s", (value, valid) => {
    if (valid) {
      expect(LocalTime.parse(value)).toBe(value);
    } else {
      expect(() => LocalTime.parse(value)).toThrow();
    }
  });
});
