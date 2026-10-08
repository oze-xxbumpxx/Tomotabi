import { openNotificationTarget, showPushNotification } from "./handlers";
import type { ServiceWorkerScopeLike } from "./types";

function readPushData(data: { json(): unknown } | null): unknown {
  if (data === null) return null;
  try {
    return data.json();
  } catch {
    return null;
  }
}

/** `push`と`notificationclick`のイベントを`waitUntil`で処理を保つ形で登録する。 */
export function registerServiceWorker(scope: ServiceWorkerScopeLike): void {
  scope.addEventListener("push", (event) => {
    event.waitUntil(
      showPushNotification(readPushData(event.data), scope.registration),
    );
  });
  scope.addEventListener("notificationclick", (event) => {
    event.waitUntil(
      openNotificationTarget(
        event.notification,
        scope.clients,
        scope.location.origin,
      ),
    );
  });
}
