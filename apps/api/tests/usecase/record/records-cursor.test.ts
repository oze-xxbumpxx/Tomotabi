import { describe, expect, it } from "vitest";
import {
  decodeRecordsCursor,
  encodeRecordsCursor,
} from "../../../src/modules/record/usecase/records-cursor";

const TRIP_ID = "99999999-9999-4999-8999-999999999999";
const OTHER_TRIP_ID = "11111111-1111-4111-8111-111111111111";
const PLAN_ID = "88888888-8888-4888-8888-888888888888";
const OTHER_PLAN_ID = "88888888-8888-4888-8888-000000000000";
const RECORD_ID = "77777777-7777-4777-8777-000000000001";

const SCOPE = { tripId: TRIP_ID, type: null, planId: null } as const;

describe("記録の一覧のカーソル（RU-04）", () => {
  it("最後の行の種類・IDに旅行のIDと絞り込みの条件を結びつけて符号・読み戻しできる", () => {
    const cursor = encodeRecordsCursor({
      tripId: TRIP_ID,
      type: "payment",
      planId: PLAN_ID,
      kind: "payment",
      id: RECORD_ID,
    });

    expect(
      decodeRecordsCursor(cursor, {
        tripId: TRIP_ID,
        type: "payment",
        planId: PLAN_ID,
      }),
    ).toEqual({ kind: "payment", id: RECORD_ID });
  });

  it("取り消しの行のカーソルは種類を保つ（同じ日時・同じIDの元の記録と区別できる）", () => {
    // 元の記録と取り消しはIDが同じ。ページの境目に来ても、カーソルの種類で
    // 取り消しの行を起点にできる（片方を飛ばさない）。
    const cancelled = encodeRecordsCursor({
      tripId: TRIP_ID,
      type: null,
      planId: null,
      kind: "payment_cancellation",
      id: RECORD_ID,
    });
    const original = encodeRecordsCursor({
      tripId: TRIP_ID,
      type: null,
      planId: null,
      kind: "payment",
      id: RECORD_ID,
    });

    expect(cancelled).not.toBe(original);
    expect(decodeRecordsCursor(cancelled, SCOPE)).toEqual({
      kind: "payment_cancellation",
      id: RECORD_ID,
    });
    expect(decodeRecordsCursor(original, SCOPE)).toEqual({
      kind: "payment",
      id: RECORD_ID,
    });
  });

  it("デコード不能・形が違うカーソルは400 INVALID_REQUEST", () => {
    for (const bad of [
      "not-a-cursor",
      Buffer.from(JSON.stringify("just a string")).toString("base64url"),
      Buffer.from(JSON.stringify({ i: RECORD_ID })).toString("base64url"),
      Buffer.from(
        JSON.stringify({
          t: TRIP_ID,
          y: null,
          p: null,
          k: "not_a_kind",
          i: RECORD_ID,
        }),
      ).toString("base64url"),
      Buffer.from(
        JSON.stringify({
          t: TRIP_ID,
          y: null,
          p: null,
          k: "payment",
          i: "not-a-uuid",
        }),
      ).toString("base64url"),
    ]) {
      expect(() => decodeRecordsCursor(bad, SCOPE)).toThrowError(
        expect.objectContaining({ code: "INVALID_REQUEST", status: 400 }),
      );
    }
  });

  it("別の旅行に紐付くカーソルは400", () => {
    const cursor = encodeRecordsCursor({
      tripId: OTHER_TRIP_ID,
      type: null,
      planId: null,
      kind: "payment",
      id: RECORD_ID,
    });

    expect(() => decodeRecordsCursor(cursor, SCOPE)).toThrowError(
      expect.objectContaining({ code: "INVALID_REQUEST", status: 400 }),
    );
  });

  it("絞り込みの条件が違うカーソルは400（種類・予定）", () => {
    const typedCursor = encodeRecordsCursor({
      tripId: TRIP_ID,
      type: "payment",
      planId: null,
      kind: "payment",
      id: RECORD_ID,
    });
    const plannedCursor = encodeRecordsCursor({
      tripId: TRIP_ID,
      type: null,
      planId: PLAN_ID,
      kind: "payment",
      id: RECORD_ID,
    });

    expect(() => decodeRecordsCursor(typedCursor, SCOPE)).toThrowError(
      expect.objectContaining({ code: "INVALID_REQUEST", status: 400 }),
    );
    expect(() => decodeRecordsCursor(plannedCursor, SCOPE)).toThrowError(
      expect.objectContaining({ code: "INVALID_REQUEST", status: 400 }),
    );
    expect(() =>
      decodeRecordsCursor(plannedCursor, {
        tripId: TRIP_ID,
        type: null,
        planId: OTHER_PLAN_ID,
      }),
    ).toThrowError(
      expect.objectContaining({ code: "INVALID_REQUEST", status: 400 }),
    );
  });
});
