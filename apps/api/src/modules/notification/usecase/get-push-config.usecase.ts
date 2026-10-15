import { ApiError } from "../../../common/http/api-error.js";
import type {
  GetPushConfigInputPort,
  PushConfig,
} from "../adapter/inbound/get-push-config.input-port.js";
import type { VapidKeyringPort } from "../adapter/outbound/vapid-keyring.port.js";
import { MAX_ACTIVE_PUSH_SUBSCRIPTIONS } from "../domain/push-subscription.js";

/**
 * GET /me/push-config。今のVAPIDの公開鍵とkeyIdを返す。
 * 鍵の設定が無い・崩れているときは503 PUSH_UNAVAILABLE
 * （このコードを返すのは設定のAPIだけ）。
 */
export class GetPushConfigUseCase implements GetPushConfigInputPort {
  constructor(private readonly vapidKeyring: VapidKeyringPort) {}

  execute(): Promise<PushConfig> {
    const ring = this.vapidKeyring.snapshot;
    if (ring.status !== "ready" || ring.current.publicKey === null) {
      return Promise.reject(
        new ApiError({
          code: "PUSH_UNAVAILABLE",
          status: 503,
          message: "Push notifications are not available",
        }),
      );
    }
    return Promise.resolve({
      publicVapidKey: ring.current.publicKey,
      keyId: ring.current.keyId,
      maxActiveSubscriptions: MAX_ACTIVE_PUSH_SUBSCRIPTIONS,
    });
  }
}
