import { createECDH, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import webpush from "web-push";
import type {
  PushRequestDetails,
  PushTransport,
} from "../../src/modules/notification/adapter/outbound/push-transport";
import { WebPushSender } from "../../src/modules/notification/infrastructure/web-push-sender";

const ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc123";

class RecordingTransport implements PushTransport {
  requests: PushRequestDetails[] = [];
  status = 201;
  async send(request: PushRequestDetails) {
    this.requests.push(request);
    return { status: this.status };
  }
}

// PU-07: 送る要求のヘッダーと署名
describe("WebPushSender（PU-07）", () => {
  it("TTL:300・Urgency:normal・aes128gcmで、購読のvapid_key_idの鍵で署名する", async () => {
    const vapid = webpush.generateVAPIDKeys();
    const subscriber = createECDH("prime256v1");
    subscriber.generateKeys();
    const p256dh = subscriber.getPublicKey();
    const authSecret = randomBytes(16);
    const transport = new RecordingTransport();
    const sender = new WebPushSender(transport);

    const outcome = await sender.send({
      endpoint: ENDPOINT,
      p256dh,
      authSecret,
      vapidKey: {
        keyId: "vapid-1",
        state: "current",
        publicKey: vapid.publicKey,
        privateKey: vapid.privateKey,
      },
      subject: "mailto:ops@example.com",
      payload: JSON.stringify({ hello: "world" }),
    });

    expect(outcome.status).toBe(201);
    expect(transport.requests).toHaveLength(1);
    const request = transport.requests[0];
    expect(request.endpoint).toBe(ENDPOINT);
    expect(request.method).toBe("POST");
    expect(request.headers.TTL).toBe("300");
    expect(request.headers.Urgency).toBe("normal");
    expect(request.headers["Content-Encoding"]).toBe("aes128gcm");
    // VAPID署名: Authorizationにvapid方式と購読に記録した鍵の公開鍵。
    const authorization = request.headers.Authorization;
    expect(authorization).toMatch(/^[Vv]apid /);
    expect(authorization).toContain(vapid.publicKey);
    // 本文は暗号化済み（生のJSONは見えない）。
    expect(request.body.length).toBeGreaterThan(0);
    expect(request.body.toString("utf8")).not.toContain("hello");
  });

  it("秘密鍵を持たない鍵（revoked）では送らない", async () => {
    const transport = new RecordingTransport();
    const sender = new WebPushSender(transport);
    await expect(
      sender.send({
        endpoint: ENDPOINT,
        p256dh: Buffer.alloc(65, 4),
        authSecret: Buffer.alloc(16, 7),
        vapidKey: {
          keyId: "vapid-old",
          state: "revoked",
          publicKey: null,
          privateKey: null,
        },
        subject: "mailto:ops@example.com",
        payload: "{}",
      }),
    ).rejects.toThrow();
    expect(transport.requests).toHaveLength(0);
  });
});
