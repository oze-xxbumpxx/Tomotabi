import { describe, expect, it } from "vitest";
import { LocalDate } from "../../src/common/domain/local-date";
import { TripPeriod } from "../../src/modules/planning/domain/trip-period";

describe("TripPeriod", () => {
  it("U-07: 開始 = 終了（日帰り）は成功、逆順は例外", () => {
    const day = LocalDate.parse("2026-09-01");
    expect(TripPeriod.create(day, day)).toEqual({ startsOn: day, endsOn: day });
    expect(() =>
      TripPeriod.create(LocalDate.parse("2026-09-03"), LocalDate.parse("2026-09-01")),
    ).toThrow();
  });

  it("U-07: contains は両端を含む", () => {
    const period = TripPeriod.create(
      LocalDate.parse("2026-09-01"),
      LocalDate.parse("2026-09-03"),
    );
    expect(TripPeriod.contains(period, LocalDate.parse("2026-09-01"))).toBe(true);
    expect(TripPeriod.contains(period, LocalDate.parse("2026-09-03"))).toBe(true);
    expect(TripPeriod.contains(period, LocalDate.parse("2026-09-02"))).toBe(true);
    expect(TripPeriod.contains(period, LocalDate.parse("2026-08-31"))).toBe(false);
    expect(TripPeriod.contains(period, LocalDate.parse("2026-09-04"))).toBe(false);
  });
});
