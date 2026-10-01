import { describe, expect, it } from "vitest";
import { SignedYen } from "../../../src/common/domain/yen";
import {
  deriveTargets,
  InvalidClaimStateError,
  type ActiveClaim,
  type PaymentForDerivation,
} from "../../../src/modules/settlement/domain/settlement-target";

const SETTLED_BY_S1 = "11111111-1111-4111-8111-111111111111";

function payment(id: string, contribution: bigint): PaymentForDerivation {
  return { id, contribution: SignedYen.fromBigInt(contribution) };
}

function claim(
  paymentId: string,
  kind: ActiveClaim["kind"],
  settlementId: string,
): ActiveClaim {
  return { paymentId, kind, settlementId };
}

describe("deriveTargets", () => {
  const base = claim("p", "BASE", SETTLED_BY_S1);
  const reversal = claim("p", "REVERSAL", "22222222-2222-4222-8222-222222222222");

  it.each([
    // [支払いの状態, 占有, 期待される対象]（正本「次回対象の導出」の表どおり）
    {
      name: "有効・精算前 → BASE（寄与 c）",
      cancelled: false,
      claims: [] as ActiveClaim[],
      expected: [
        { paymentId: "p", kind: "BASE", contribution: 3000n, baseSettlementId: null },
      ],
    },
    {
      name: "有効・精算済み → 対象なし",
      cancelled: false,
      claims: [base],
      expected: [],
    },
    {
      name: "取り消し済み・精算前 → 対象なし",
      cancelled: true,
      claims: [] as ActiveClaim[],
      expected: [],
    },
    {
      name: "取り消し済み・精算済み・戻しなし → REVERSAL（−c、元の精算を指す）",
      cancelled: true,
      claims: [base],
      expected: [
        {
          paymentId: "p",
          kind: "REVERSAL",
          contribution: -3000n,
          baseSettlementId: base.settlementId,
        },
      ],
    },
    {
      name: "取り消し済み・精算済み・戻し済み → 対象なし",
      cancelled: true,
      claims: [base, reversal],
      expected: [],
    },
  ])("FU-05: $name", ({ cancelled, claims, expected }) => {
    const targets = deriveTargets(
      [payment("p", 3000n)],
      new Set(cancelled ? ["p"] : []),
      claims,
    );
    expect(targets).toEqual(
      expected.map((t) => ({
        ...t,
        contribution: SignedYen.fromBigInt(t.contribution),
      })),
    );
  });

  it("FU-06: 戻しだけが有効な状態は不正として検出する", () => {
    expect(() =>
      deriveTargets([payment("p", 3000n)], new Set(["p"]), [reversal]),
    ).toThrow(InvalidClaimStateError);
    // 有効な支払いでも同じく不正
    expect(() =>
      deriveTargets([payment("p", 3000n)], new Set(), [reversal]),
    ).toThrow(
      expect.objectContaining({ reason: "REVERSAL_WITHOUT_BASE" }),
    );
  });

  it("FU-06: 有効な支払いに戻しがある状態は不正として検出する", () => {
    expect(() =>
      deriveTargets([payment("p", 3000n)], new Set(), [base, reversal]),
    ).toThrow(
      expect.objectContaining({ reason: "REVERSAL_ON_ACTIVE_PAYMENT" }),
    );
  });
});
