/**
 * ブラウザの通知の機能の有無を読む。window・navigatorに触れるので、
 * 呼び出しはeffect以降（サーバー描画では使わない）。
 */
export type PushCapabilities = {
  /** iOSの画面で`navigator.standalone`がfalse、かつ`PushManager`が無い。 */
  iosNeedsHomeScreen: boolean;
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
  /** `Notification.permission`。Notificationが無ければnull。 */
  permission: NotificationPermission | null;
};

export function readPushCapabilities(): PushCapabilities {
  const hasServiceWorker = "serviceWorker" in navigator;
  const hasPushManager = "PushManager" in window;
  const hasNotification = "Notification" in window;
  // navigator.standaloneはiOSだけのプロパティ。falseならホーム画面に
  // 追加していないiOSのブラウザ（追加したアプリから開いたときだけ
  // PushManagerが現れる）。
  const standalone = (navigator as { standalone?: boolean }).standalone;
  const iosNeedsHomeScreen = standalone === false && !hasPushManager;
  return {
    iosNeedsHomeScreen,
    hasServiceWorker,
    hasPushManager,
    hasNotification,
    permission: hasNotification ? window.Notification.permission : null,
  };
}
