import { describe, expect, it } from "vitest";
import {
  PUSH_ACTIONS_BY_TARGET_KIND,
  PUSH_ACTOR_NAME_MAX_LENGTH,
  PUSH_PAYLOAD_MAX_BYTES,
  PUSH_PAYLOAD_SCHEMA_VERSION,
  PUSH_TRIP_NAME_MAX_LENGTH,
  type PushAction,
  type PushTargetKind,
} from "@tomotabi/contracts";
import type { UserId } from "../../src/common/domain/user-id";
import {
  buildNotificationMessage,
  NOTIFICATION_TITLE,
} from "../../src/modules/notification/domain/notification-message";
import type { NotificationEvent } from "../../src/modules/notification/domain/notification-event";

const TRIP_ID = "99999999-9999-4999-8999-999999999999";
const ACTOR = "00000000-0000-4000-8000-000000000001" as UserId;
const TARGET_ID = "88888888-8888-4888-8888-888888888888";

function eventOf(
  targetKind: PushTargetKind,
  action: PushAction,
): NotificationEvent {
  return {
    targetKind,
    action,
    eventId: "11111111-1111-4111-8111-111111111111",
    tripId: TRIP_ID,
    targetId: TARGET_ID,
    actorUserId: ACTOR,
    occurredAt: "2026-09-05T12:00:00.000Z",
  } as NotificationEvent;
}

const NAMES = { actorName: "はな", tripName: "京都の旅" };

// PU-03: 本文の形と操作の言葉
describe("通知の本文（PU-03）", () => {
  const EXPECTED: Readonly<Record<PushAction, string>> = {
    plan_added: "予定を追加しました",
    plan_cancelled: "予定を取りやめました",
    plan_moved: "予定の日を移しました",
    achievement_added: "達成を記録しました",
    achievement_cancelled: "達成の記録を取り消しました",
    booking_added: "予約済みを記録しました",
    booking_cancelled: "予約済みの記録を取り消しました",
    payment_added: "支払いを記録しました",
    payment_cancelled: "支払いの記録を取り消しました",
    settlement_completed: "精算を記録しました",
    settlement_cancelled: "精算を取り消しました",
  };

  it.each(
    Object.entries(PUSH_ACTIONS_BY_TARGET_KIND).flatMap(([kind, actions]) =>
      actions.map(
        (action) =>
          [kind as PushTargetKind, action as PushAction] as const,
      ),
    ),
  )("%sの%sは「{相手}が「{旅行}」で{操作}」の形", (kind, action) => {
    const message = buildNotificationMessage(eventOf(kind, action), NAMES);
    expect(message.title).toBe(NOTIFICATION_TITLE);
    expect(message.title).toBe("tomotabi");
    // F-40の形: 外側にかぎかっこは付けない。
    expect(message.body).toBe(`はなが「京都の旅」で${EXPECTED[action]}`);
  });

  it("許可された11組以外の組み合わせは組み立てない", () => {
    expect(() =>
      buildNotificationMessage(
        eventOf("plan", "payment_added" as PushAction),
        NAMES,
      ),
    ).toThrow();
  });
});

// PU-04: 名前の切り詰めと2KBの上限
describe("名前の切り詰めと中身の上限（PU-04）", () => {
  const graphemes = (text: string): string[] =>
    [...new Intl.Segmenter("ja", { granularity: "grapheme" }).segment(text)].map(
      (part) => part.segment,
    );

  it("相手の名前は20文字・旅行の名前は30文字で「…」に切り詰める", () => {
    const message = buildNotificationMessage(
      eventOf("plan", "plan_added"),
      {
        actorName: "あ".repeat(21),
        tripName: "い".repeat(31),
      },
    );
    const payload = JSON.parse(message.payload) as {
      actorName: string;
      tripName: string;
    };
    expect(graphemes(payload.actorName)).toHaveLength(
      PUSH_ACTOR_NAME_MAX_LENGTH,
    );
    expect(payload.actorName.endsWith("…")).toBe(true);
    expect(graphemes(payload.tripName)).toHaveLength(PUSH_TRIP_NAME_MAX_LENGTH);
    expect(payload.tripName.endsWith("…")).toBe(true);
  });

  it("絵文字（ZWJ結合）と結合文字を途中で切らない", () => {
    // 👨‍👩‍👧はZWJで3文字つながる1書記素。「が」は仮名+濁点の結合。
    const family = "👨‍👩‍👧";
    const combining = "か\u3099"; // か + 濁点
    const actorName = "あ".repeat(18) + family + combining + "x";
    const message = buildNotificationMessage(
      eventOf("plan", "plan_added"),
      { actorName, tripName: "京都の旅" },
    );
    const payload = JSON.parse(message.payload) as { actorName: string };
    const parts = graphemes(payload.actorName);
    expect(parts.length).toBeLessThanOrEqual(PUSH_ACTOR_NAME_MAX_LENGTH);
    expect(Array.from(payload.actorName).length).toBeLessThanOrEqual(
      PUSH_ACTOR_NAME_MAX_LENGTH,
    );
    expect(payload.actorName.endsWith("…")).toBe(true);
    // 末尾は「…」、その1つ前は書記素の途中で切られていない
    // （familyかcombiningのどちらかが丸ごと残るか、両方落ちる）。
    const before = parts.slice(0, -1).join("");
    for (const unit of [family, combining]) {
      if (actorName.includes(unit) && before.includes(unit)) {
        expect(before).toContain(unit);
      }
    }
    // 半端な結合文字が残っていないか: 濁点単独が末尾近くに無い
    expect(payload.actorName).not.toMatch(/\u3099$/);
  });

  it("書記素数が上限内でもコードポイント数が上限を超える名前は詰める", () => {
    // 受け手（apps/webのpayload.ts）はコードポイント数で上限を調べる。
    // 仮名18+家族絵文字（1書記素・7コードポイント）は書記素19で送り側の
    // 上限20には収まるが、コードポイント25で受け側の上限を超えるため詰める。
    const family = "👨‍👩‍👧"; // 1書記素・7コードポイント
    const actorName = "あ".repeat(18) + family;
    expect(graphemes(actorName)).toHaveLength(19);
    const message = buildNotificationMessage(
      eventOf("plan", "plan_added"),
      { actorName, tripName: "京都の旅" },
    );
    const payload = JSON.parse(message.payload) as { actorName: string };
    expect(Array.from(payload.actorName).length).toBeLessThanOrEqual(
      PUSH_ACTOR_NAME_MAX_LENGTH,
    );
    expect(Array.from(payload.actorName).length).toBeGreaterThanOrEqual(1);
    expect(graphemes(payload.actorName).length).toBeLessThanOrEqual(
      PUSH_ACTOR_NAME_MAX_LENGTH,
    );
    expect(payload.actorName.endsWith("…")).toBe(true);
  });

  it("2KBへの切り詰めで1書記素しか残らない名前も空にしない", () => {
    // 結合文字を大量に持つ1書記素の名前は書記素数ではこれ以上詰められず、
    // 上限0を呼ぶと空になって受け手に捨てられる。最小は「…」。
    const giant = "あ" + "゙".repeat(3_000); // 1書記素・数千コードポイント
    const message = buildNotificationMessage(
      eventOf("plan", "plan_added"),
      { actorName: giant, tripName: "京都の旅" },
    );
    expect(Buffer.byteLength(message.payload, "utf8")).toBeLessThanOrEqual(
      PUSH_PAYLOAD_MAX_BYTES,
    );
    const payload = JSON.parse(message.payload) as {
      actorName: string;
      tripName: string;
    };
    expect(payload.actorName.length).toBeGreaterThanOrEqual(1);
    expect(Array.from(payload.actorName).length).toBeLessThanOrEqual(
      PUSH_ACTOR_NAME_MAX_LENGTH,
    );
    expect(payload.actorName).toBe("…");
  });

  it("旅行の名前100文字でもUTF-8のJSON全体が2KB以内", () => {
    const message = buildNotificationMessage(
      eventOf("settlement", "settlement_completed"),
      { actorName: "はな", tripName: "旅".repeat(100) },
    );
    expect(Buffer.byteLength(message.payload, "utf8")).toBeLessThanOrEqual(
      PUSH_PAYLOAD_MAX_BYTES,
    );
  });

  it("相手の名前10,000文字でもUTF-8のJSON全体が2KB以内", () => {
    const message = buildNotificationMessage(
      eventOf("plan", "plan_added"),
      { actorName: "🌋".repeat(10_000), tripName: "旅".repeat(500) },
    );
    expect(Buffer.byteLength(message.payload, "utf8")).toBeLessThanOrEqual(
      PUSH_PAYLOAD_MAX_BYTES,
    );
    const parsed = JSON.parse(message.payload) as { actorName: string };
    expect(parsed.actorName.length).toBeLessThan(10_000);
  });
});

// PU-05: 中身の項目（持つもの・持たないもの）
describe("通知の中身の項目（PU-05）", () => {
  it("決められた項目だけを持つ（金額・場所・予定の名前・URLを含めない）", () => {
    const event = eventOf("payment", "payment_added");
    const message = buildNotificationMessage(event, NAMES);
    const payload = JSON.parse(message.payload) as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(
      [
        "schemaVersion",
        "eventId",
        "tripId",
        "targetId",
        "occurredAt",
        "actorName",
        "tripName",
        "targetKind",
        "action",
      ].sort(),
    );
    expect(payload.schemaVersion).toBe(PUSH_PAYLOAD_SCHEMA_VERSION);
    expect(payload.eventId).toBe(event.eventId);
    expect(payload.tripId).toBe(TRIP_ID);
    expect(payload.targetId).toBe(TARGET_ID);
    expect(payload.occurredAt).toBe("2026-09-05T12:00:00.000Z");
    expect(payload.actorName).toBe("はな");
    expect(payload.tripName).toBe("京都の旅");
    expect(payload.targetKind).toBe("payment");
    expect(payload.action).toBe("payment_added");
    // 操作した人のIDなど、決められていない項目は入れない。
    expect(payload.actorUserId).toBeUndefined();
    // 本文にもURL・金額を含めない。
    expect(message.body).not.toContain("http");
    expect(message.body).not.toMatch(/\d+円/);
  });
});
