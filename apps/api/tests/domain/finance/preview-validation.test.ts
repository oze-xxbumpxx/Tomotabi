import { describe, expect, it } from "vitest";
import type {
  CurrentClaimState,
  PreviewItemExpectation,
} from "../../../src/modules/settlement/domain/preview-validation";
import { validatePreview } from "../../../src/modules/settlement/domain/preview-validation";

const PAYMENT_ID = "77777777-7777-4777-8777-000000000001";
const OTHER_PAYMENT_ID = "77777777-7777-4777-8777-000000000002";
const SETTLEMENT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-000000000001";
const FINGERPRINT =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER_FINGERPRINT =
  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function item(
  overrides: Partial<PreviewItemExpectation> = {},
): PreviewItemExpectation {
  return {
    paymentId: PAYMENT_ID,
    kind: "BASE",
    expectedFingerprint: FINGERPRINT,
    expectedCancelled: false,
    ...overrides,
  };
}

function states(
  entries: readonly [string, CurrentClaimState][],
): Map<string, CurrentClaimState> {
  return new Map(entries);
}

const MATCHING: CurrentClaimState = {
  fingerprint: FINGERPRINT,
  cancelled: false,
};

describe("確認の検証結果", () => {
  it("指紋と取り消し状態が明細と一致すれば ready", () => {
    const result = validatePreview(
      [item()],
      states([[PAYMENT_ID, MATCHING]]),
      null,
    );
    expect(result).toEqual({
      status: "ready",
      cancelledPaymentIds: [],
      changedPaymentIds: [],
      existingSettlementId: null,
    });
  });

  it("BASE 対象の支払いがあとで取り消されれば cancelled_items_ack_required", () => {
    const result = validatePreview(
      [item()],
      states([[PAYMENT_ID, { fingerprint: FINGERPRINT, cancelled: true }]]),
      null,
    );
    expect(result).toEqual({
      status: "cancelled_items_ack_required",
      cancelledPaymentIds: [PAYMENT_ID],
      changedPaymentIds: [],
      existingSettlementId: null,
    });
  });

  it("指紋が違えば target_changed。取り消しの違いより指紋の違いが優先", () => {
    const result = validatePreview(
      [item(), item({ paymentId: OTHER_PAYMENT_ID })],
      states([
        [PAYMENT_ID, { fingerprint: OTHER_FINGERPRINT, cancelled: true }],
        [OTHER_PAYMENT_ID, { fingerprint: FINGERPRINT, cancelled: true }],
      ]),
      null,
    );
    expect(result).toEqual({
      status: "target_changed",
      changedPaymentIds: [PAYMENT_ID],
      cancelledPaymentIds: [OTHER_PAYMENT_ID],
      existingSettlementId: null,
    });
  });

  it("精算があれば有効なら already_completed、取り消し済みなら completed_then_cancelled", () => {
    const completed = validatePreview(
      [item()],
      states([[PAYMENT_ID, { fingerprint: OTHER_FINGERPRINT, cancelled: true }]]),
      { id: SETTLEMENT_ID, cancelled: false },
    );
    expect(completed).toEqual({
      status: "already_completed",
      cancelledPaymentIds: [],
      changedPaymentIds: [],
      existingSettlementId: SETTLEMENT_ID,
    });

    const cancelled = validatePreview(
      [item()],
      states([[PAYMENT_ID, MATCHING]]),
      { id: SETTLEMENT_ID, cancelled: true },
    );
    expect(cancelled).toEqual({
      status: "completed_then_cancelled",
      cancelledPaymentIds: [],
      changedPaymentIds: [],
      existingSettlementId: SETTLEMENT_ID,
    });
  });

  it("戻しの明細（kind=REVERSAL）は支払いが取り消しでも了承の対象にしない", () => {
    const result = validatePreview(
      [item({ kind: "REVERSAL", expectedCancelled: true })],
      states([[PAYMENT_ID, { fingerprint: FINGERPRINT, cancelled: true }]]),
      null,
    );
    expect(result.status).toBe("ready");
    expect(result.cancelledPaymentIds).toEqual([]);
  });

  it("明細の支払いが今の状態に無いのは target_changed 扱い（黙って ready にしない）", () => {
    const result = validatePreview([item()], states([]), null);
    expect(result.status).toBe("target_changed");
    expect(result.changedPaymentIds).toEqual([PAYMENT_ID]);
  });
});
