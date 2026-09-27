import { describe, expect, it } from "vitest";
import { computeRequestHash } from "../../src/common/idempotency/command-receipt";

const BASE = {
  operation: "updatePlan",
  tripId: "550e8400-e29b-41d4-a716-446655440000",
  resourceId: "660e8400-e29b-41d4-a716-446655440000",
  body: { name: "清水寺", memo: "9 時集合" },
  ifMatch: "3",
} as const;

describe("computeRequestHash", () => {
  it("U-14: 同じ入力は同じ 64 桁の 16 進を返す", () => {
    const hash = computeRequestHash(BASE);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(computeRequestHash(BASE)).toBe(hash);
  });

  it("U-14: body のキー順序だけ違っても同じ hash", () => {
    const reordered = {
      ...BASE,
      body: { memo: "9 時集合", name: "清水寺" },
    };
    expect(computeRequestHash(reordered)).toBe(computeRequestHash(BASE));
  });

  it("U-14: 名前の前後の空白だけ違っても同じ hash（検証後の正規化と同じ規則）", () => {
    const padded = {
      ...BASE,
      body: { name: "  清水寺  ", memo: "9 時集合" },
    };
    expect(computeRequestHash(padded)).toBe(computeRequestHash(BASE));
  });

  it("U-14: If-Match が違えば違う hash", () => {
    expect(computeRequestHash({ ...BASE, ifMatch: "4" })).not.toBe(
      computeRequestHash(BASE),
    );
  });

  it("U-14: tripId が違えば違う hash", () => {
    expect(
      computeRequestHash({ ...BASE, tripId: "770e8400-e29b-41d4-a716-446655440000" }),
    ).not.toBe(computeRequestHash(BASE));
  });

  it("U-14: operation・resourceId・body の値が違えば違う hash", () => {
    expect(computeRequestHash({ ...BASE, operation: "renameTrip" })).not.toBe(
      computeRequestHash(BASE),
    );
    expect(
      computeRequestHash({ ...BASE, resourceId: "880e8400-e29b-41d4-a716-446655440000" }),
    ).not.toBe(computeRequestHash(BASE));
    expect(
      computeRequestHash({ ...BASE, body: { name: "金閣寺", memo: "9 時集合" } }),
    ).not.toBe(computeRequestHash(BASE));
  });
});
