import { createHash } from "node:crypto";
import type { Clock } from "../../../adapter/clock/clock";
import type { UserId } from "../../../common/domain/user-id";
import { ApiError } from "../../../common/http/api-error";
import { isUniqueViolation } from "../../planning/usecase/trip-write-flow";
import type {
  PushRegistrationInput,
  PutPushSubscriptionInputPort,
} from "../adapter/inbound/put-push-subscription.input-port";
import type {
  NotificationUnitOfWork,
  PushSubscriptionRow,
} from "../adapter/outbound/push-subscription.repository";
import type { VapidKeyringPort } from "../adapter/outbound/vapid-keyring.port";
import { checkPushEndpoint } from "../domain/push-endpoint";
import { parsePushKeys } from "../domain/push-keys";
import {
  MAX_ACTIVE_PUSH_SUBSCRIPTIONS,
  type PushSubscriptionItem,
} from "../domain/push-subscription";
import { toPushSubscriptionItem } from "./push-subscription-item";

const ENDPOINT_MAX_LENGTH = 4096;
const DEVICE_LABEL_MAX_LENGTH = 60;

/**
 * PUT /me/push-subscriptions（購読の登録・更新、設計書「購読の登録」）。
 *
 * ロックの前に確かめる: 宛先の決まり・鍵の形・keyIdが今の鍵・
 * 期限が未来。本文のuserIdは受け取らず、持ち主はセッションから。
 *
 * 1トランザクションで: 自分のusers行をFOR UPDATEで取り、
 * 停止の記録に今のセッションがあれば409、期限切れの自分の購読を
 * 無効にし、同じ宛先を他人が持てば409、この登録で有効な数が
 * 増えるなら上限を確かめ、あとは挿入または更新する。中身が
 * 同じ再登録は版を上げない。
 */
export class PutPushSubscriptionUseCase
  implements PutPushSubscriptionInputPort
{
  constructor(
    private readonly unitOfWork: NotificationUnitOfWork,
    private readonly vapidKeyring: VapidKeyringPort,
    private readonly clock: Clock,
  ) {}

  async execute(
    userId: UserId,
    sessionId: string,
    input: PushRegistrationInput,
  ): Promise<PushSubscriptionItem> {
    if (
      input.endpoint.length > ENDPOINT_MAX_LENGTH ||
      input.deviceLabel.length > DEVICE_LABEL_MAX_LENGTH
    ) {
      throw new ApiError({
        code: "VALIDATION_FAILED",
        status: 400,
        message: "Request fields are out of range",
      });
    }
    const endpointCheck = checkPushEndpoint(input.endpoint);
    if (!endpointCheck.ok) {
      throw new ApiError({
        code: "UNSUPPORTED_PUSH_SERVICE",
        status: 422,
        message: "This push endpoint is not supported",
      });
    }
    const keys = parsePushKeys(input.keys);
    if (!keys.ok) {
      throw new ApiError({
        code: "INVALID_PUSH_SUBSCRIPTION",
        status: 422,
        message: "The subscription keys are invalid",
      });
    }
    const ring = this.vapidKeyring.snapshot;
    // 鍵の束が読めないときは「今の鍵」が無いため、どのkeyIdも一致しない。
    if (ring.status !== "ready" || input.keyId !== ring.current.keyId) {
      throw new ApiError({
        code: "PUSH_KEY_CHANGED",
        status: 409,
        message: "The push key has changed; fetch the push config again",
      });
    }
    const now = this.clock.now();
    const expirationTime =
      input.expirationTime === null ? null : new Date(input.expirationTime);
    if (expirationTime !== null && expirationTime.getTime() <= now.getTime()) {
      throw new ApiError({
        code: "VALIDATION_FAILED",
        status: 400,
        message: "expirationTime must be in the future",
      });
    }
    const endpointHash = createHash("sha256")
      .update(input.endpoint, "utf8")
      .digest();

    const row = await this.unitOfWork.run(async (ctx) => {
      const repo = ctx.subscriptions;
      await repo.lockOwner(userId);
      if (await repo.isSessionClosed(sessionId)) {
        throw new ApiError({
          code: "PUSH_SESSION_CLOSED",
          status: 409,
          message: "This session is closed for push registration",
        });
      }
      await repo.disableExpired(userId, now);
      const existing = await repo.findByEndpointHash(endpointHash);
      if (existing !== null && existing.userId !== userId) {
        throw new ApiError({
          code: "PUSH_ENDPOINT_OWNED_BY_OTHER",
          status: 409,
          message: "This endpoint is registered by another account",
        });
      }
      // 有効な数が増えるのは、新規または無効だった同じ宛先を戻すとき。
      const increasesEnabled = existing === null || !existing.enabled;
      if (
        increasesEnabled &&
        (await repo.countEnabled(userId)) >= MAX_ACTIVE_PUSH_SUBSCRIPTIONS
      ) {
        throw new ApiError({
          code: "PUSH_LIMIT_REACHED",
          status: 409,
          message: "The limit of active push subscriptions is reached",
        });
      }
      try {
        if (existing === null) {
          return await repo.insert(
            {
              userId,
              endpoint: input.endpoint,
              endpointHash,
              p256dh: keys.p256dh,
              authSecret: keys.authSecret,
              expirationTime,
              registrationSessionId: sessionId,
              deviceLabel: input.deviceLabel,
              vapidKeyId: input.keyId,
            },
            now,
          );
        }
        if (sameContent(existing, input, keys, expirationTime, sessionId)) {
          // 中身が同じ再登録は版を上げない（冪等）。
          return existing;
        }
        return await repo.update(
          existing.id,
          {
            endpoint: input.endpoint,
            p256dh: keys.p256dh,
            authSecret: keys.authSecret,
            expirationTime,
            registrationSessionId: sessionId,
            deviceLabel: input.deviceLabel,
            vapidKeyId: input.keyId,
          },
          now,
        );
      } catch (error) {
        // 同じ宛先を別の人が同時に登録した競合は一意制約の違反で届く。
        if (isUniqueViolation(error)) {
          throw new ApiError({
            code: "PUSH_ENDPOINT_OWNED_BY_OTHER",
            status: 409,
            message: "This endpoint is registered by another account",
          });
        }
        throw error;
      }
    });
    return toPushSubscriptionItem(row, this.vapidKeyring, sessionId);
  }
}

/**
 * 再登録で中身が同じか。registrationSessionIdも比べる
 * （別セッションからの再登録は「この端末」の記録が変わるため更新する）。
 */
function sameContent(
  row: PushSubscriptionRow,
  input: PushRegistrationInput,
  keys: { p256dh: Buffer; authSecret: Buffer },
  expirationTime: Date | null,
  sessionId: string,
): boolean {
  return (
    row.enabled &&
    row.endpoint === input.endpoint &&
    row.p256dh.equals(keys.p256dh) &&
    row.authSecret.equals(keys.authSecret) &&
    sameInstant(row.expirationTime, expirationTime) &&
    row.registrationSessionId === sessionId &&
    row.deviceLabel === input.deviceLabel &&
    row.vapidKeyId === input.keyId
  );
}

function sameInstant(a: Date | null, b: Date | null): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  return a.getTime() === b.getTime();
}
