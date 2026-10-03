import { describe, expect, it } from "vitest";
import { LocalDate } from "../../src/common/domain/local-date";

describe("LocalDate", () => {
  it.each([
    ["2028-02-29", true],
    ["2026-02-29", false],
    ["2026-13-01", false],
    ["2026-9-1", false],
    ["2026-02-30", false],
    ["2026-00-10", false],
    ["2026-01-00", false],
    ["2026-01-32", false],
    ["not-a-date", false],
    ["2026-09-01T00:00:00Z", false],
  ])("U-05: %s は実在日として%s", (value, valid) => {
    if (valid) {
      expect(LocalDate.parse(value)).toBe(value);
    } else {
      expect(() => LocalDate.parse(value)).toThrow();
    }
  });

  it("compare は前後関係を返す", () => {
    const a = LocalDate.parse("2026-09-01");
    const b = LocalDate.parse("2026-09-02");
    expect(LocalDate.compare(a, b)).toBeLessThan(0);
    expect(LocalDate.compare(b, a)).toBeGreaterThan(0);
    expect(LocalDate.compare(a, LocalDate.parse("2026-09-01"))).toBe(0);
  });

  it("daysBetween は日数の差を返す", () => {
    expect(
      LocalDate.daysBetween(
        LocalDate.parse("2026-09-01"),
        LocalDate.parse("2026-09-03"),
      ),
    ).toBe(2);
    // うるう年の2/29をまたぐ
    expect(
      LocalDate.daysBetween(
        LocalDate.parse("2028-02-28"),
        LocalDate.parse("2028-03-01"),
      ),
    ).toBe(2);
  });
});
