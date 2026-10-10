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

/** 末尾の切り詰め記号。受け手が求める「1文字以上」を満たす最小の名前でもある。 */
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

/** コードポイント数（受け手のcodePointLengthと同じ数え方）。 */
function codePoints(text: string): number {
  return Array.from(text).length;
}

/**
 * 名前をmaxLengthまでに切る。書記素数とコードポイント数の両方が上限内に
 * なるよう先頭から書記素を残し、末尾を「…」にする（絵文字・結合文字を
 * 途中で切らない）。受け手はコードポイント数で上限を調べるため、ここで
 * 両方を満たす。1書記素も上限に収まらないときは「…」だけを返す
 * （空の名前は受け手に捨てられるため）。
 */
function truncateName(name: string, maxLength: number): string {
  if (maxLength <= 0) {
    return "";
  }
  const parts = graphemes(name);
  if (parts.length <= maxLength && codePoints(name) <= maxLength) {
    return name;
  }
  // 末尾の「…」の分を引いた上限。
  const limit = maxLength - 1;
  let keptCodePoints = 0;
  const kept: string[] = [];
  for (const part of parts) {
    if (kept.length >= limit || keptCodePoints + codePoints(part) > limit) {
      break;
    }
    kept.push(part);
    keptCodePoints += codePoints(part);
  }
  return kept.join("") + ELLIPSIS;
}

/** 2KBに収めるため名前を1書記素分だけ詰める。空にはせず最小は「…」。 */
function shrinkName(name: string): string {
  if (graphemes(name).length <= 1) {
    return ELLIPSIS;
  }
  return truncateName(name, graphemes(name).length - 1);
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
 * 相手の名前は20・旅行の名前は30で切る（書記素数・コードポイント数の
 * 両方が上限内。受け手はコードポイント数で調べる）。組み立てたJSONを
 * UTF-8で測って2KBを超えるときは長い方の名前をさらに短くする。
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
  // 2KBを超えるときは長い方の名前を1書記素ずつ詰める。
  // 名前は「…」までしか詰めない（空の名前は受け手に捨てられるため）。
  while (Buffer.byteLength(payload, "utf8") > PUSH_PAYLOAD_MAX_BYTES) {
    const actorCount = actorName === ELLIPSIS ? 0 : graphemes(actorName).length;
    const tripCount = tripName === ELLIPSIS ? 0 : graphemes(tripName).length;
    if (actorCount === 0 && tripCount === 0) {
      // 名前を「…」まで詰めてもJSONの骨格だけで2KBを超えることはない。
      // ここに来るのは想定外の入力なので、無限ループを避けて投げる。
      throw new Error("通知の中身を2KB以内に収められません");
    }
    if (actorCount >= tripCount) {
      actorName = shrinkName(actorName);
    } else {
      tripName = shrinkName(tripName);
    }
    payload = toPayload();
  }

  return {
    title: NOTIFICATION_TITLE,
    body: `${actorName}が「${tripName}」で${ACTION_TEXTS[event.action]}`,
    payload,
  };
}
