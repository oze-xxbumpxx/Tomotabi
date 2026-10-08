import type { VapidKey, VapidKeyring } from "../../domain/vapid-keyring";

export const VAPID_KEYRING = Symbol("VAPID_KEYRING");

/**
 * VAPIDの鍵の束の読み取り口。実装は環境変数を読むEnvVapidKeyring。
 */
export interface VapidKeyringPort {
  readonly snapshot: VapidKeyring;
  keyFor(keyId: string): VapidKey | null;
}
