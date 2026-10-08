import { describe, expect, it } from "vitest";
import type { PushPayload } from "@tomotabi/contracts";
import { openPathForPushPayload } from "@/shared/push/open-path";

const tripId = "8a6e0804-2bd0-4672-b79d-d97027f9071a";
const targetId = "6d6a86a1-6d0b-4c0f-9bb9-9a1d3a9e9c01";

function payload(action: string, targetKind: string): PushPayload {
  return {
    schemaVersion: 1,
    eventId: "550e8400-e29b-41d4-a716-446655440000",
    action,
    tripId,
    targetKind,
    targetId,
    occurredAt: "2026-10-08T13:25:00.000Z",
    actorName: "あおい",
    tripName: "沖縄旅行",
  } as PushPayload;
}

describe("openPathForPushPayload（開くパス）", () => {
  it("予定の3種類は予定の詳細を開く", () => {
    for (const action of ["plan_added", "plan_cancelled", "plan_moved"]) {
      expect(openPathForPushPayload(payload(action, "plan"))).toBe(
        `/trips/${tripId}/plans/${targetId}`,
      );
    }
  });

  it.each([
    ["achievement_added", "achievement"],
    ["achievement_cancelled", "achievement"],
    ["booking_added", "booking"],
    ["booking_cancelled", "booking"],
    ["payment_added", "payment"],
    ["payment_cancelled", "payment"],
  ])("%s（%s）は記録の一覧のその1件に絞った表示を開く", (action, targetKind) => {
    expect(openPathForPushPayload(payload(action, targetKind))).toBe(
      `/trips/${tripId}/records?recordType=${targetKind}&recordId=${targetId}`,
    );
  });

  it("精算の完了と取り消しは精算の画面のその1件を開く", () => {
    for (const action of ["settlement_completed", "settlement_cancelled"]) {
      expect(openPathForPushPayload(payload(action, "settlement"))).toBe(
        `/trips/${tripId}/settlement?settlementId=${targetId}`,
      );
    }
  });

  it("取り消しは元のID（payloadのtargetId）で開く", () => {
    // 取り消しのイベントのtargetIdは元の記録・精算のIDなので、そのまま使う。
    expect(
      openPathForPushPayload(payload("payment_cancelled", "payment")),
    ).toBe(`/trips/${tripId}/records?recordType=payment&recordId=${targetId}`);
  });
});
