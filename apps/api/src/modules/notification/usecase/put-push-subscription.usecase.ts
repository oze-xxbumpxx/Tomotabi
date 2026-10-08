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
  PushSubscriptionUpdate,
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

// 制御文字（NULを含む\p{Cc}）はDBのtextに入れると接続の層で失敗し、
// 500になるため、入力の時点で断る。
const CONTROL_CHAR = /\p{Cc}/u;

const invalidRequest = (message: string): ApiError =>
  new ApiError({ code: "INVALID_REQUEST", status: 400, message });

/**
 * PUT /me/push-subscriptions（購読の登録・更新、設計書「購読の登録」）。
 *
 * ロックの前に確かめる: 宛先の決まり・鍵の形・keyIdが今の鍵・
 * 期限が未来。本文のuserIdは受け取らず、持ち主はセッションから。
 * 宛先は確かめた結果の正規化した値（url.href）で保存・
 * ハッシュ・比較する（生の入力とは違い得る）。
 *
 * 1トランザクションで: 自分のusers行をFOR UPDATEで取り、
 * 停止の記録に今のセッションがあれば409、期限切れの自分の購読を
 * 無効にし、同じ宛先を他人が有効で持てば409（他人の無効な行は
 * 持ち主を書き換えて引き取る）、この登録で有効な数が増えるなら
 * 上限を確かめ、あとは挿入または更新する。中身が同じ再登録は
 * 版を上げない。
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
      throw invalidRequest("Request fields are out of range");
    }
    if (CONTROL_CHAR.test(input.deviceLabel)) {
      throw invalidRequest("deviceLabel must not contain control characters");
    }
    const endpointCheck = checkPushEndpoint(input.endpoint);
    if (!endpointCheck.ok) {
      throw new ApiError({
        code: "UNSUPPORTED_PUSH_SERVICE",
        status: 422,
        message: "This push endpoint is not supported",
      });
    }
    // 確かめた結果の正規化した値を、保存・ハッシュ・比較のすべてに使う。
    const endpoint = endpointCheck.endpoint;
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
      throw invalidRequest("expirationTime must be in the future");
    }
    const endpointHash = createHash("sha256").update(endpoint, "utf8").digest();

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
      const takeOver =
        existing !== null && existing.userId !== userId && !existing.enabled;
      if (existing !== null && existing.userId !== userId && !takeOver) {
        throw new ApiError({
          code: "PUSH_ENDPOINT_OWNED_BY_OTHER",
          status: 409,
          message: "This endpoint is registered by another account",
        });
      }
      // 有効な数が増えるのは、新規または無効だった同じ宛先を戻すとき
      // （他人の無効な行の引き取りも1件増える）。
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
      const fields = {
        endpoint,
        p256dh: keys.p256dh,
        authSecret: keys.authSecret,
        expirationTime,
        registrationSessionId: sessionId,
        deviceLabel: input.deviceLabel,
        vapidKeyId: input.keyId,
      };
      try {
        if (existing === null) {
          return await repo.insert(
            { userId, endpointHash, ...fields },
            now,
          );
        }
        const written = takeOver
          ? await repo.takeOver(existing.id, userId, fields, now)
          : sameContent(existing, fields)
            ? // 中身が同じ再登録は版を上げない（冪等）。
              existing
            : await repo.update(existing.id, userId, fields, now);
        if (written === null) {
          // takeOver / update が0件なら、読んでから持ち主が変わった
          // 競合の負け。他人の宛先と同じ409にする（500にしない）。
          throw new ApiError({
            code: "PUSH_ENDPOINT_OWNED_BY_OTHER",
            status: 409,
            message: "This endpoint is registered by another account",
          });
        }
        return written;
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
 * endpointの比較は正規化した値どうし（行にも正規化した値が入る）。
 */
function sameContent(
  row: PushSubscriptionRow,
  fields: PushSubscriptionUpdate,
): boolean {
  return (
    row.enabled &&
    row.endpoint === fields.endpoint &&
    row.p256dh.equals(fields.p256dh) &&
    row.authSecret.equals(fields.authSecret) &&
    sameInstant(row.expirationTime, fields.expirationTime) &&
    row.registrationSessionId === fields.registrationSessionId &&
    row.deviceLabel === fields.deviceLabel &&
    row.vapidKeyId === fields.vapidKeyId
  );
}

function sameInstant(a: Date | null, b: Date | null): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  return a.getTime() === b.getTime();
}
