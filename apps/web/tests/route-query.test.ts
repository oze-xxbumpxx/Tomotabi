import { describe, expect, it } from "vitest";
import {
  parseItineraryQuery,
  parsePaymentNewQuery,
  parsePlanDetailQuery,
  parsePlanNewQuery,
  parseRecordsQuery,
  parseSettlementQuery,
} from "@/app/trips/[tripId]/route-query";

// 以前の各page.tsxがサーバーで行っていた読み解きと同じ結果になる（SS-T06b）。
const q = (search: string) => new URLSearchParams(search);
const ID = "550e8400-e29b-41d4-a716-446655440000";
const ID2 = "6ba7b810-9dad-41d1-80b4-00c04fd430c8";

describe("parseItineraryQuery", () => {
  it.each([
    ["", null],
    ["date=", null],
    ["date=abc", null],
    ["date=2026-02-30", null],
    ["date=2026-10-12", "2026-10-12"],
    ["date=2026-10-12&date=2026-10-13", "2026-10-12"],
    ["date=&date=2026-10-13", null],
  ])("%s → %s", (search, date) => {
    expect(parseItineraryQuery(q(search))).toEqual({ date });
  });
});

describe("parseRecordsQuery", () => {
  it("種類は許可リストだけ、予定のIDはUUIDの形だけ通す", () => {
    expect(parseRecordsQuery(q("type=payment&planId=" + ID))).toEqual({
      type: "payment",
      planId: ID,
      recordId: null,
      recordType: null,
    });
    expect(parseRecordsQuery(q("type=other&planId=x"))).toMatchObject({
      type: null,
      planId: null,
    });
  });

  it("recordIdとrecordTypeは両方そろって形が正しいときだけ渡す", () => {
    expect(parseRecordsQuery(q(`recordId=${ID}&recordType=booking`))).toMatchObject({
      recordId: ID,
      recordType: "booking",
    });
    expect(parseRecordsQuery(q(`recordId=${ID}`))).toMatchObject({
      recordId: null,
      recordType: null,
    });
    expect(parseRecordsQuery(q("recordId=bad&recordType=booking"))).toMatchObject({
      recordId: null,
      recordType: null,
    });
  });
});

describe("parseSettlementQuery", () => {
  it.each([
    ["", null],
    ["settlementId=bad", null],
    [`settlementId=${ID}`, ID],
    [`settlementId=${ID}&settlementId=${ID2}`, ID],
  ])("%s → %s", (search, focusSettlementId) => {
    expect(parseSettlementQuery(q(search))).toEqual({ focusSettlementId });
  });
});

describe("parsePlanNewQuery・parsePlanDetailQuery", () => {
  it("空でなければそのまま渡す（日付の確かめは画面が行う）", () => {
    expect(parsePlanNewQuery(q("date=abc"))).toEqual({ date: "abc" });
    expect(parsePlanNewQuery(q("date="))).toEqual({ date: null });
    expect(parsePlanDetailQuery(q("from=home"))).toEqual({ from: "home" });
    expect(parsePlanDetailQuery(q(""))).toEqual({ from: null });
  });
});

describe("parsePaymentNewQuery", () => {
  it("planIdとfromはUUIDの形のときだけ渡す", () => {
    expect(parsePaymentNewQuery(q(`planId=${ID}&from=${ID2}`))).toEqual({
      planId: ID,
      fromPaymentId: ID2,
    });
    expect(parsePaymentNewQuery(q("planId=x&from="))).toEqual({
      planId: null,
      fromPaymentId: null,
    });
  });
});
