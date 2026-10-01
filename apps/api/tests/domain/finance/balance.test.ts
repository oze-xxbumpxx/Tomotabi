import { describe, expect, it } from "vitest";
import { SignedYen } from "../../../src/common/domain/yen";
import { balanceOf } from "../../../src/modules/settlement/domain/balance";
import type { SettlementTarget } from "../../../src/modules/settlement/domain/settlement-target";

function target(paymentId: string, contribution: bigint): SettlementTarget {
  return {
    paymentId,
    kind: "BASE",
    contribution: SignedYen.fromBigInt(contribution),
    baseSettlementId: null,
  };
}

describe("balanceOf", () => {
  it("FU-07: 対象 0 件と、対象ありで合計 0 円を区別する", () => {
    const none = balanceOf([]);
    expect(none.targetCount).toBe(0);
    expect(none.signedTotal).toBe(0n);
    expect(none.amount).toBe(0n);
    expect(none.fromSlot).toBeNull();
    expect(none.toSlot).toBeNull();

    // 互いに同額を立て替えた形。対象はあるが合計は 0 円
    const zero = balanceOf([target("a", 500n), target("b", -500n)]);
    expect(zero.targetCount).toBe(2);
    expect(zero.signedTotal).toBe(0n);
    expect(zero.amount).toBe(0n);
    expect(zero.fromSlot).toBeNull();
    expect(zero.toSlot).toBeNull();
  });

  it("FU-07: 合計が正なら参加者番号 1 の人から 0 の人へ払う", () => {
    const balance = balanceOf([target("a", 3000n), target("b", -500n)]);
    expect(balance.signedTotal).toBe(2500n);
    expect(balance.amount).toBe(2500n);
    expect(balance.fromSlot).toBe(1);
    expect(balance.toSlot).toBe(0);
  });

  it("FU-07: 合計が負なら参加者番号 0 の人から 1 の人へ払う", () => {
    const balance = balanceOf([target("a", -700n)]);
    expect(balance.signedTotal).toBe(-700n);
    expect(balance.amount).toBe(700n);
    expect(balance.fromSlot).toBe(0);
    expect(balance.toSlot).toBe(1);
  });
});
