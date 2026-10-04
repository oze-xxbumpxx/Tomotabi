import { describe, expect, it } from "vitest";
import { addedAfterPreviewCount } from "@/features/settlement";
import type {
  Payment,
  PreviewValidationStatus,
  TargetItem,
} from "@/features/settlement";

const tripId = "8a6e0804-2bd0-4672-b79d-d97027f9071a";
const userId = "550e8400-e29b-41d4-a716-446655440000";

function payment(id: string): Payment {
  return {
    id,
    tripId,
    planId: null,
    label: `支払い ${id}`,
    amountYen: "1000",
    payerUserId: userId,
    allocations: [{ userId, percent: 100, burdenYen: "1000" }],
    createdBy: userId,
    createdAt: "2026-10-01T12:00:00.000Z",
    cancellation: null,
  };
}

function itemOf(paymentId: string, kind: TargetItem["kind"] = "BASE"): TargetItem {
  return {
    payment: payment(paymentId),
    kind,
    signedContributionYen: "1000",
    baseSettlementId: null,
  };
}

const NON_COUNTABLE_STATUSES: PreviewValidationStatus[] = [
  "target_changed",
  "already_completed",
  "completed_then_cancelled",
];

describe("addedAfterPreviewCount（RU-08）", () => {
  it("readyのとき、確認の明細に無い残額の対象だけを数える", () => {
    const previewItems = [itemOf("p1"), itemOf("p2")];
    const balanceItems = [itemOf("p1"), itemOf("p2"), itemOf("p3")];
    // 明細にある支払い（p1・p2）は数えない。確認のあとの追加分p3だけ1件。
    expect(addedAfterPreviewCount("ready", previewItems, balanceItems)).toBe(1);
    // 追加分がなければ0件（案内は出さない）。
    expect(
      addedAfterPreviewCount("ready", previewItems, previewItems),
    ).toBe(0);
  });

  it("cancelled_items_ack_requiredのときも同じ基準で数える", () => {
    const previewItems = [itemOf("p1")];
    const balanceItems = [itemOf("p3"), itemOf("p4")];
    expect(
      addedAfterPreviewCount(
        "cancelled_items_ack_required",
        previewItems,
        balanceItems,
      ),
    ).toBe(2);
  });

  it("確認の明細に無いREVERSALは数えない（取り消し済みの戻しは追加ではない）", () => {
    const previewItems = [itemOf("p1")];
    // 精算済みの支払いが確認のあとに取り消されると、残額にその戻しが出る。
    const balanceItems = [itemOf("p1"), itemOf("p9", "REVERSAL")];
    expect(addedAfterPreviewCount("ready", previewItems, balanceItems)).toBe(0);
  });

  it("ほかの状態では数えない（追加分があってもnull）", () => {
    const previewItems = [itemOf("p1")];
    const balanceItems = [itemOf("p1"), itemOf("p9")];
    for (const status of NON_COUNTABLE_STATUSES) {
      expect(
        addedAfterPreviewCount(status, previewItems, balanceItems),
      ).toBeNull();
    }
  });
});
