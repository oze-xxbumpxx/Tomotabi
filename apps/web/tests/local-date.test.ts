import { describe, expect, it } from "vitest";
import {
  formatLocalDate,
  formatTripPeriod,
} from "@/shared/lib/local-date";

describe("formatLocalDate", () => {
  it("月/日のすぐ後ろに半角かっこで曜日を返す", () => {
    expect(formatLocalDate("2026-11-01")).toBe("11/1(日)");
    expect(formatLocalDate("2026-10-12")).toBe("10/12(月)");
    expect(formatLocalDate("2026-10-14")).toBe("10/14(水)");
  });

  it("月と日は0埋めしない", () => {
    expect(formatLocalDate("2026-01-05")).toBe("1/5(月)");
  });
});

describe("formatTripPeriod", () => {
  it("期間は`開始 – 終了`の形で両端に曜日を付ける", () => {
    expect(formatTripPeriod("2026-10-12", "2026-10-14")).toBe(
      "10/12(月) – 10/14(水)",
    );
  });

  it("1日だけの旅行は1つだけ出す", () => {
    expect(formatTripPeriod("2026-10-12", "2026-10-12")).toBe("10/12(月)");
  });
});
