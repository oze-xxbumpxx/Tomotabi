import webpush from "web-push";
import type {
  PushSender,
  PushSendOutcome,
  PushSendRequest,
} from "../adapter/outbound/push-sender";
import type { PushTransport } from "../adapter/outbound/push-transport";

/**
 * Web Pushで送る部品（設計書「送る部品」）。web-pushの
 * generateRequestDetailsで暗号化とVAPID署名をした要求を作り、
 * PushTransportに渡す。購読に記録したvapid_key_idの鍵で署名する。
 */
export class WebPushSender implements PushSender {
  constructor(private readonly transport: PushTransport) {}

  async send(request: PushSendRequest): Promise<PushSendOutcome> {
    const { vapidKey } = request;
    if (vapidKey.publicKey === null || vapidKey.privateKey === null) {
      // revoked・秘密鍵を持たない鍵では署名できない（UseCase側で除く設計だが、
      // 部品としても守る）。
      throw new Error("この鍵では署名できません");
    }
    const details = webpush.generateRequestDetails(
      {
        endpoint: request.endpoint,
        keys: {
          p256dh: request.p256dh.toString("base64url"),
          auth: request.authSecret.toString("base64url"),
        },
      },
      request.payload,
      {
        TTL: 300,
        urgency: "normal",
        contentEncoding: "aes128gcm",
        vapidDetails: {
          subject: request.subject,
          publicKey: vapidKey.publicKey,
          privateKey: vapidKey.privateKey,
        },
      },
    );
    const startedAt = Date.now();
    const { status } = await this.transport.send({
      endpoint: details.endpoint,
      method: details.method,
      // web-pushはTTLを数値で返すので、HTTPの頭文字の一覧として文字列に揃える。
      headers: Object.fromEntries(
        Object.entries(details.headers).map(([name, value]) => [
          name,
          String(value),
        ]),
      ),
      body: details.body,
    });
    return { status, durationMs: Date.now() - startedAt };
  }
}
