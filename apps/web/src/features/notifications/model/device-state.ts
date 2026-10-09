import type { PushSubscription } from "../api/notifications-api";

/**
 * 「この端末」の状態。設計書の7つの状態を、表の上から順に1つに決める
 * （PU-14）。ブラウザ・API・端末の記憶から集めた入力だけを見る純粋な関数。
 */
export type DeviceNotificationState =
  /** iPhoneでホーム画面への追加が要る（追加したアイコンから開いたときだけ通知が使える）。 */
  | "needs-home-screen-app"
  /** 使えない（serviceWorker・PushManager・Notificationのどれかが無い、または鍵の設定が崩れている）。 */
  | "unavailable"
  /** まだ許可していない・まだ有効にしていない（許可を求めていない、または許可済みだが購読も記憶も無い）。 */
  | "not-enabled"
  /** 許可を断った。 */
  | "denied"
  /** ブラウザでは登録したがAPIに未登録（登録し直す）。 */
  | "browser-only"
  /** 有効。 */
  | "enabled"
  /** APIで無効になった（enabled=falseまたはvapidKeyStateがrevoked。登録し直す案内）。 */
  | "api-disabled";

export type DeviceNotificationInput = {
  /** iOSの画面で`navigator.standalone`がfalse、かつ`PushManager`が無い。 */
  iosNeedsHomeScreen: boolean;
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
  /** `Notification.permission`。Notificationが無ければnull。 */
  permission: NotificationPermission | null;
  /**
   * GET /api/me/push-configが503（PUSH_UNAVAILABLE）ならtrue。
   * 鍵の設定が崩れているときは一覧のvapidKeyStateより先にこれを見て
   * 「使えない」と出す（一覧は全部revokedで返るため、先に見ないと
   * 「APIで無効」と誤って案内する）。
   */
  pushConfigUnavailable: boolean;
  /** `pushManager.getSubscription()`が購読を返した。 */
  hasBrowserSubscription: boolean;
  /**
   * localStorageに覚えた「今のendpointに対応する購読のID」に対応する
   * 一覧の行。IDが無い・一覧に無ければnull。
   */
  currentRow: Pick<
    PushSubscription,
    "enabled" | "vapidKeyState"
  > | null;
  /** 一覧にisCurrentSessionの有効な行がある。 */
  hasCurrentSessionEnabledRow: boolean;
};

export function determineDeviceNotificationState(
  input: DeviceNotificationInput,
): DeviceNotificationState {
  // iPhoneでホーム画面に追加していないときはPushManagerが無く「使えない」にも
  // 当てはまるので、先に判定する。
  if (input.iosNeedsHomeScreen) {
    return "needs-home-screen-app";
  }
  if (
    !input.hasServiceWorker ||
    !input.hasPushManager ||
    !input.hasNotification
  ) {
    return "unavailable";
  }
  // 鍵の設定の崩れは一覧のvapidKeyStateより先に見る（上のコメント）。
  if (input.pushConfigUnavailable) {
    return "unavailable";
  }
  if (input.permission === "default") {
    return "not-enabled";
  }
  if (input.permission === "denied") {
    return "denied";
  }
  if (input.hasBrowserSubscription && !input.hasCurrentSessionEnabledRow) {
    return "browser-only";
  }
  if (input.currentRow !== null) {
    if (
      input.hasBrowserSubscription &&
      input.currentRow.enabled &&
      input.currentRow.vapidKeyState !== "revoked"
    ) {
      return "enabled";
    }
    if (!input.currentRow.enabled || input.currentRow.vapidKeyState === "revoked") {
      return "api-disabled";
    }
  }
  // 表に無い組み合わせ（許可済みだが購読も記憶も無いなど）は、有効にする
  // 案内を出す「まだ有効にしていない」に寄せる。
  return "not-enabled";
}
