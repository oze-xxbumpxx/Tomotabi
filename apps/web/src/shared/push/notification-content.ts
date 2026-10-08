import type { PushAction } from "@tomotabi/contracts";
import { openPathForPushPayload, FALLBACK_OPEN_PATH } from "./open-path";
import { parsePushPayload } from "./payload";

/** 通知のタイトル（F-40）。 */
export const PUSH_NOTIFICATION_TITLE = "tomotabi";

/** 中身が確かめられなかったときの汎用の文（F-45・E-10）。 */
export const GENERIC_NOTIFICATION_BODY =
  "アプリで最新の情報をご確認ください";

/** 操作の言葉（F-41の11種類）。 */
const ACTION_TEXT: Record<PushAction, string> = {
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

/** Service Workerが`showNotification`に渡す中身。 */
export type PushNotificationContent = {
  title: string;
  body: string;
  /** 通知を押したときに開くパス。同じオリジンの中だけ。 */
  openPath: string;
  /** `showNotification`のtag。中身が確かめられたときだけeventId（F-46）。 */
  tag: string | null;
};

/**
 * 届いた中身から通知の表示内容を決める。形が決まりに合えば
 * 「{相手の名前}が「{旅行の名前}」で{操作}」と対象のパス、
 * 合わなければ汎用の文と旅行一覧へのパスを返す（F-45）。
 */
export function notificationContentOf(data: unknown): PushNotificationContent {
  const payload = parsePushPayload(data);
  if (payload === null) {
    return {
      title: PUSH_NOTIFICATION_TITLE,
      body: GENERIC_NOTIFICATION_BODY,
      openPath: FALLBACK_OPEN_PATH,
      tag: null,
    };
  }
  return {
    title: PUSH_NOTIFICATION_TITLE,
    body: `${payload.actorName}が「${payload.tripName}」で${ACTION_TEXT[payload.action]}`,
    openPath: openPathForPushPayload(payload),
    tag: payload.eventId,
  };
}
