import type { PushSubscriptionRow } from "../adapter/outbound/push-subscription.repository";
import type { VapidKeyringPort } from "../adapter/outbound/vapid-keyring.port";
import type { PushSubscriptionItem } from "../domain/push-subscription";

/**
 * DBの行を応答の項目に写す。宛先と鍵の列はここで落とす。
 * vapidKeyStateは登録時のkeyIdが今の鍵の束でどの状態か
 * （束に無いkeyIdは「revoked」とみなす）。
 */
export function toPushSubscriptionItem(
  row: PushSubscriptionRow,
  vapidKeyring: VapidKeyringPort,
  sessionId: string,
): PushSubscriptionItem {
  return {
    id: row.id,
    deviceLabel: row.deviceLabel,
    enabled: row.enabled,
    vapidKeyState: vapidKeyring.keyFor(row.vapidKeyId)?.state ?? "revoked",
    isCurrentSession: row.registrationSessionId === sessionId,
    updatedAt: row.updatedAt.toISOString(),
  };
}
