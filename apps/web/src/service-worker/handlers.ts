import { notificationContentOf } from "@/shared/push/notification-content";
import { FALLBACK_OPEN_PATH } from "@/shared/push/open-path";
import type { ClientsLike, ServiceWorkerScopeLike } from "./types";

/**
 * 通知に入れた`data.path`を取り出す。先頭が`/`で`//`で始まらない
 * ものだけを開き、それ以外は旅行一覧にする（決まったパス以外を開かない）。
 */
export function openPathFromNotificationData(data: unknown): string {
  if (typeof data === "object" && data !== null && "path" in data) {
    const { path } = data as { path: unknown };
    if (
      typeof path === "string" &&
      path.startsWith("/") &&
      !path.startsWith("//")
    ) {
      return path;
    }
  }
  return FALLBACK_OPEN_PATH;
}

function isSameOrigin(clientUrl: string, origin: string): boolean {
  try {
    return new URL(clientUrl).origin === origin;
  } catch {
    return false;
  }
}

/**
 * `push`イベントの中身を確かめて通知を出す（F-45〜F-47）。
 * APIは読まない。`tag`は`eventId`。
 */
export async function showPushNotification(
  data: unknown,
  registration: ServiceWorkerScopeLike["registration"],
): Promise<void> {
  const content = notificationContentOf(data);
  await registration.showNotification(content.title, {
    body: content.body,
    ...(content.tag !== null ? { tag: content.tag } : {}),
    data: { path: content.openPath },
  });
}

/**
 * `notificationclick`イベント。通知を閉じ、同じオリジンのウィンドウが
 * あれば`focus`して`navigate`、無ければ`openWindow`する（F-53・F-54）。
 */
export async function openNotificationTarget(
  notification: { data: unknown; close(): void },
  clients: ClientsLike,
  origin: string,
): Promise<void> {
  notification.close();
  const path = openPathFromNotificationData(notification.data);
  const windowClients = await clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });
  const target = windowClients.find((client) =>
    isSameOrigin(client.url, origin),
  );
  if (target !== undefined) {
    await target.focus();
    await target.navigate(path);
    return;
  }
  await clients.openWindow(path);
}
