import { describe, expect, it } from "vitest";
import {
  GENERIC_NOTIFICATION_BODY,
  notificationContentOf,
  PUSH_NOTIFICATION_TITLE,
} from "@/shared/push/notification-content";
import { parsePushPayload } from "@/shared/push/payload";

const eventId = "550e8400-e29b-41d4-a716-446655440000";
const tripId = "8a6e0804-2bd0-4672-b79d-d97027f9071a";
const targetId = "6d6a86a1-6d0b-4c0f-9bb9-9a1d3a9e9c01";

function payload(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    eventId,
    action: "payment_added",
    tripId,
    targetKind: "payment",
    targetId,
    occurredAt: "2026-10-08T13:25:00.000Z",
    actorName: "あおい",
    tripName: "沖縄旅行",
    ...overrides,
  };
}

describe("parsePushPayload（中身の確かめ方）", () => {
  it("決まった形の中身はPushPayloadとして返す", () => {
    expect(parsePushPayload(payload())).toEqual(payload());
  });

  it("項目が多い・足りないときは null", () => {
    expect(parsePushPayload(payload({ extra: "x" }))).toBeNull();
    const { eventId: _omit, ...missing } = payload();
    expect(parsePushPayload(missing)).toBeNull();
  });

  it("actionとtargetKindの組み合わせが違えば null", () => {
    expect(
      parsePushPayload(payload({ action: "settlement_completed", targetKind: "plan" })),
    ).toBeNull();
    expect(parsePushPayload(payload({ action: "unknown_action" }))).toBeNull();
    expect(parsePushPayload(payload({ targetKind: "unknown_kind" }))).toBeNull();
  });

  it("UUIDでないIDは null", () => {
    expect(parsePushPayload(payload({ eventId: "not-uuid" }))).toBeNull();
    expect(parsePushPayload(payload({ tripId: "not-uuid" }))).toBeNull();
    expect(parsePushPayload(payload({ targetId: "not-uuid" }))).toBeNull();
  });

  it("日時でないoccurredAtは null", () => {
    expect(parsePushPayload(payload({ occurredAt: "きのう" }))).toBeNull();
    expect(
      parsePushPayload(payload({ occurredAt: "2026-13-45T99:99:99Z" })),
    ).toBeNull();
    expect(parsePushPayload(payload({ occurredAt: "2026-10-08" }))).toBeNull();
  });

  it("長すぎる名前は null。上限ぴったりは有効", () => {
    expect(
      parsePushPayload(payload({ actorName: "あ".repeat(21) })),
    ).toBeNull();
    expect(parsePushPayload(payload({ actorName: "あ".repeat(20) }))).not.toBeNull();
    expect(parsePushPayload(payload({ tripName: "あ".repeat(31) }))).toBeNull();
    expect(parsePushPayload(payload({ tripName: "あ".repeat(30) }))).not.toBeNull();
    // 絵文字はUTF-16で2つ分。コードポイント数では20個まで有効。
    expect(
      parsePushPayload(payload({ actorName: "🎒".repeat(20) })),
    ).not.toBeNull();
    expect(parsePushPayload(payload({ actorName: "🎒".repeat(21) }))).toBeNull();
  });

  it("版が違えば null", () => {
    expect(parsePushPayload(payload({ schemaVersion: 2 }))).toBeNull();
    expect(parsePushPayload(payload({ schemaVersion: "1" }))).toBeNull();
  });

  it("オブジェクトでないものは null", () => {
    expect(parsePushPayload(null)).toBeNull();
    expect(parsePushPayload(undefined)).toBeNull();
    expect(parsePushPayload("payload")).toBeNull();
    expect(parsePushPayload([1, 2, 3])).toBeNull();
  });
});

describe("notificationContentOf（通知の表示の内容）", () => {
  it("決まった形なら「{相手}が「{旅行}」で{操作}」と開くパスを返す", () => {
    const content = notificationContentOf(payload());
    expect(content.title).toBe("tomotabi");
    expect(content.body).toBe("あおいが「沖縄旅行」で支払いを記録しました");
    expect(content.openPath).toBe(
      `/trips/${tripId}/records?recordType=payment&recordId=${targetId}`,
    );
    expect(content.tag).toBe(eventId);
  });

  it.each([
    ["plan_added", "plan", "予定を追加しました"],
    ["plan_cancelled", "plan", "予定を取りやめました"],
    ["plan_moved", "plan", "予定の日を移しました"],
    ["achievement_added", "achievement", "達成を記録しました"],
    ["achievement_cancelled", "achievement", "達成の記録を取り消しました"],
    ["booking_added", "booking", "予約済みを記録しました"],
    ["booking_cancelled", "booking", "予約済みの記録を取り消しました"],
    ["payment_added", "payment", "支払いを記録しました"],
    ["payment_cancelled", "payment", "支払いの記録を取り消しました"],
    ["settlement_completed", "settlement", "精算を記録しました"],
    ["settlement_cancelled", "settlement", "精算を取り消しました"],
  ])("%s（%s）の本文は「%s」", (action, targetKind, text) => {
    const content = notificationContentOf(payload({ action, targetKind }));
    expect(content.body).toBe(`あおいが「沖縄旅行」で${text}`);
  });

  it("形が違えば汎用の文と旅行一覧へのパスを返す", () => {
    const content = notificationContentOf({ wrong: "shape" });
    expect(content.title).toBe(PUSH_NOTIFICATION_TITLE);
    expect(content.body).toBe(GENERIC_NOTIFICATION_BODY);
    expect(content.body).toBe("アプリで最新の情報をご確認ください");
    expect(content.openPath).toBe("/trips");
    expect(content.tag).toBeNull();
  });
});
