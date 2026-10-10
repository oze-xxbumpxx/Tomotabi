import {
  PUSH_ACTIONS_BY_TARGET_KIND,
  PUSH_ACTOR_NAME_MAX_LENGTH,
  PUSH_PAYLOAD_MAX_BYTES,
  PUSH_PAYLOAD_SCHEMA_VERSION,
  PUSH_TRIP_NAME_MAX_LENGTH,
  type PushAction,
  type PushPayload,
} from "@tomotabi/contracts";
import type { NotificationEvent } from "./notification-event";

/** 通知に出すタイトル（アプリの名前）。 */
export const NOTIFICATION_TITLE = "tomotabi";

/** 末尾の切り詰め記号。 */
const ELLIPSIS = "…";

/**
 * 操作の言葉（F-41・要件の11種類の写し）。
 * 本文の形は「{相手の名前}が「{旅行の名前}」で{操作}」
 * （外側にかぎかっこは付けない。F-40）。
 */
const ACTION_TEXTS: Readonly<Record<PushAction, string>> = {
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

const graphemeSegmenter = new Intl.Segmenter("ja", { granularity: "grapheme" });

function graphemes(text: string): string[] {
  return [...graphemeSegmenter.segment(text)].map((part) => part.segment);
}

/**
 * 名前をmaxGraphemes文字までに切る。超えるときは絵文字・結合文字を
 * 途中で切らないよう書記素単位で落とし、末尾を「…」にする。
 * 結果はmaxGraphemes文字以内（切ったときは「…」を含む）。
 */
function truncateName(name: string, maxGraphemes: number): string {
  if (maxGraphemes <= 0) {
    return "";
  }
  const parts = graphemes(name);
  if (parts.length <= maxGraphemes) {
    return name;
  }
  return parts.slice(0, maxGraphemes - 1).join("") + ELLIPSIS;
}

/** actionとtargetKindの組み合わせが契約の11組のどれか。 */
function isAllowedAction(
  targetKind: NotificationEvent["targetKind"],
  action: string,
): action is PushAction {
  const actions: readonly string[] = PUSH_ACTIONS_BY_TARGET_KIND[targetKind];
  return actions.includes(action);
}

/**
 * 通知の中身。titleは通知のタイトル、bodyは「{相手}が「{旅行}」で{操作}」
 * （外側にかぎかっこは付けない）、payloadはWeb Pushで送るUTF-8のJSON
 * （PushPayload。2KB以内）。
 */
export type NotificationMessage = Readonly<{
  title: string;
  body: string;
  payload: string;
}>;

/**
 * イベントと読んだ名前2つから通知の中身を組み立てる（F-40〜F-44・B-03）。
 * 相手の名前は20文字・旅行の名前は30文字で切り、組み立てたJSONをUTF-8で
 * 測って2KBを超えるときは長い方の名前をさらに短くする。
 *
 * @throws actionとtargetKindの組み合わせが11組に無いとき。
 */
export function buildNotificationMessage(
  event: NotificationEvent,
  names: Readonly<{ actorName: string; tripName: string }>,
): NotificationMessage {
  if (!isAllowedAction(event.targetKind, event.action)) {
    throw new Error("actionとtargetKindの組み合わせが不正です");
  }
  let actorName = truncateName(names.actorName, PUSH_ACTOR_NAME_MAX_LENGTH);
  let tripName = truncateName(names.tripName, PUSH_TRIP_NAME_MAX_LENGTH);

  // eventのactionとtargetKindは判別共用体として渡されているため、
  // そのまま展開すればPushPayloadの組み合わせの決まりが保たれる。
  // actorUserIdは中身には入れない（受け手に要らない項目）。
  const toPayload = (): string => {
    const { actorUserId: _actorUserId, ...pair } = event;
    const payload: PushPayload = {
      ...pair,
      schemaVersion: PUSH_PAYLOAD_SCHEMA_VERSION,
      actorName,
      tripName,
    };
    return JSON.stringify(payload);
  };

  let payload = toPayload();
  // 2KBを超えるときは長い方の名前を1文字ずつ詰める（書記素単位）。
  while (Buffer.byteLength(payload, "utf8") > PUSH_PAYLOAD_MAX_BYTES) {
    const actorCount = graphemes(actorName).length;
    const tripCount = graphemes(tripName).length;
    if (actorCount >= tripCount && actorCount > 0) {
      actorName = truncateName(actorName, actorCount - 1);
    } else if (tripCount > 0) {
      tripName = truncateName(tripName, tripCount - 1);
    } else {
      // 名前が両方空でもJSONの骨格だけで2KBを超えることはない。
      // ここに来るのは想定外の入力なので、無限ループを避けて投げる。
      throw new Error("通知の中身を2KB以内に収められません");
    }
    payload = toPayload();
  }

  return {
    title: NOTIFICATION_TITLE,
    body: `${actorName}が「${tripName}」で${ACTION_TEXTS[event.action]}`,
    payload,
  };
}
