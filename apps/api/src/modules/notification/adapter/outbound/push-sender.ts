import type { VapidKey } from "../../domain/vapid-keyring";

export const PUSH_SENDER = Symbol("PUSH_SENDER");

/**
 * 1つの購読へ送る入力。endpointはcheckPushEndpointを通した正規化済みの値、
 * vapidKeyは購読が記録したvapid_key_idの鍵（revoked・秘密鍵なしは渡さない）。
 */
export type PushSendRequest = Readonly<{
  endpoint: string;
  p256dh: Buffer;
  authSecret: Buffer;
  vapidKey: VapidKey;
  /** VAPID_SUBJECT（運用者の連絡先）。 */
  subject: string;
  /** 通知の中身（UTF-8のJSON）。 */
  payload: string;
}>;

/** 1送りの結果。HTTPの状態と、要求を出してから応答までの時間。 */
export type PushSendOutcome = Readonly<{
  status: number;
  durationMs: number;
}>;

/**
 * Web Pushで送る口（設計書「送る部品」）。実装はweb-pushの
 * generateRequestDetailsで暗号化・署名した要求をPushTransportへ渡す。
 * 通信の失敗・時間切れは例外で伝える（HTTPの失敗応答は戻り値）。
 */
export interface PushSender {
  send(request: PushSendRequest): Promise<PushSendOutcome>;
}
