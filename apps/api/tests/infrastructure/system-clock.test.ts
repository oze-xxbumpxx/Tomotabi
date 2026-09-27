import { describe, expect, it } from "vitest";
import { LocalDate } from "../../src/common/domain/local-date";
import { SystemClock } from "../../src/infrastructure/clock/system-clock";

function clockAt(instant: string): SystemClock {
  const clock = new SystemClock();
  clock.now = () => new Date(instant);
  return clock;
}

describe("SystemClock", () => {
  it("now は現在時刻を返す", () => {
    const before = Date.now();
    const now = new SystemClock().now();
    expect(now.getTime()).toBeGreaterThanOrEqual(before);
  });

  it.each([
    ["2026-09-01T14:59:00Z", "2026-09-01"],
    ["2026-09-01T15:00:00Z", "2026-09-02"],
    ["2026-12-31T15:00:00Z", "2027-01-01"],
    ["2026-02-28T15:00:00Z", "2026-03-01"],
  ])("Asia/Tokyo の今日: %s は %s", (instant, expected) => {
    expect(clockAt(instant).today()).toBe(LocalDate.parse(expected));
  });
});
