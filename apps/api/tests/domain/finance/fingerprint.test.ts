import { describe, expect, it } from "vitest";
import {
  fingerprintOf,
  type ClaimHistory,
} from "../../../src/modules/settlement/domain/fingerprint";

const S1 = "11111111-1111-4111-8111-111111111111";
const S2 = "22222222-2222-4222-8222-222222222222";

function history(overrides: Partial<ClaimHistory> = {}): ClaimHistory {
  return {
    activeClaims: {},
    items: [],
    cancelledSettlementIds: [],
    ...overrides,
  };
}

describe("fingerprintOf", () => {
  it("FU-08: sha256 の 16 進 64 桁", () => {
    expect(fingerprintOf(history())).toMatch(/^[0-9a-f]{64}$/);
  });

  it("FU-08: 同じ履歴は同じ値になる（並びは正規化される）", () => {
    const a = fingerprintOf(
      history({
        activeClaims: { BASE: S1 },
        items: [
          { settlementId: S1, kind: "BASE" },
          { settlementId: S2, kind: "REVERSAL" },
        ],
        cancelledSettlementIds: [S2],
      }),
    );
    const b = fingerprintOf(
      history({
        activeClaims: { BASE: S1 },
        items: [
          { settlementId: S2, kind: "REVERSAL" },
          { settlementId: S1, kind: "BASE" },
        ],
        cancelledSettlementIds: [S2],
      }),
    );
    expect(a).toBe(b);
  });

  it("FU-08: 占有が元に戻っても、精算と取り消しを経ると値が変わる", () => {
    // 精算前: 占有なし・履歴なし
    const before = fingerprintOf(history());
    // 精算 → 取り消しで占有は元に戻ったが、明細と取り消しの履歴は残る
    const after = fingerprintOf(
      history({
        items: [{ settlementId: S1, kind: "BASE" }],
        cancelledSettlementIds: [S1],
      }),
    );
    expect(after).not.toBe(before);
  });

  it("FU-08: 有効な占有・明細・取り消しのどれかが変われば値が変わる", () => {
    const base = fingerprintOf(
      history({ items: [{ settlementId: S1, kind: "BASE" }] }),
    );
    expect(
      fingerprintOf(
        history({
          activeClaims: { BASE: S1 },
          items: [{ settlementId: S1, kind: "BASE" }],
        }),
      ),
    ).not.toBe(base);
    expect(
      fingerprintOf(
        history({
          items: [
            { settlementId: S1, kind: "BASE" },
            { settlementId: S2, kind: "REVERSAL" },
          ],
        }),
      ),
    ).not.toBe(base);
    expect(
      fingerprintOf(
        history({
          items: [{ settlementId: S1, kind: "BASE" }],
          cancelledSettlementIds: [S1],
        }),
      ),
    ).not.toBe(base);
  });
});
