import type { ResultAsync } from "neverthrow";
import { z } from "zod";
import type { ApiFailure } from "@/shared/api/api-failure";
import { callApi } from "@/shared/api/api-result";
import {
  disablePushSubscription as disablePushSubscriptionRequest,
  getPushConfig as getPushConfigRequest,
  listPushSubscriptions as listPushSubscriptionsRequest,
  registerPushSubscription as registerPushSubscriptionRequest,
} from "@/shared/api/generated/notifications";
import {
  GetPushConfigResponse,
  ListPushSubscriptionsResponse,
  RegisterPushSubscriptionResponse,
} from "@/shared/api/generated/notifications.zod";

import type {
  PushConfig,
  PushRegistration,
  PushSubscription,
} from "@/shared/api/generated/notifications";

// 契約の型はここから再輸出する（model・uiはgeneratedを参照しない）。
export type { PushConfig, PushRegistration, PushSubscription };

/**
 * 通知の購読APIの薄い入口。応答は契約のZodで検証してから返す。
 * 生成クライアントとzodへの参照はこの層だけに閉じる。
 */

/** GET /api/me/push-config。503 `PUSH_UNAVAILABLE`は鍵の設定の崩れ。 */
export function fetchPushConfig(): ResultAsync<PushConfig, ApiFailure> {
  return callApi(getPushConfigRequest(), GetPushConfigResponse);
}

/** GET /api/me/push-subscriptions。自分の購読の一覧。 */
export function fetchPushSubscriptions(): ResultAsync<
  { items: PushSubscription[] },
  ApiFailure
> {
  return callApi(listPushSubscriptionsRequest(), ListPushSubscriptionsResponse);
}

/** PUT /api/me/push-subscriptions。endpointで照合して登録・更新する。 */
export function putPushSubscription(
  input: PushRegistration,
): ResultAsync<PushSubscription, ApiFailure> {
  return callApi(
    registerPushSubscriptionRequest(input),
    RegisterPushSubscriptionResponse,
  );
}

/**
 * DELETE /api/me/push-subscriptions/{id}。204で本文を持たない。
 * 他人のID・無いIDも204（あるかどうかを漏らさない契約）。
 */
export function deletePushSubscription(
  id: string,
): ResultAsync<void, ApiFailure> {
  return callApi(disablePushSubscriptionRequest(id), z.unknown()).map(
    () => undefined,
  );
}
