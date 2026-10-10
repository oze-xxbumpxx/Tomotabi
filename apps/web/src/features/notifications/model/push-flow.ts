import type { ApiFailure } from "@/shared/api/api-failure";
import { deviceLabelFromUserAgent } from "@/shared/push/device-label";
import {
  deletePushSubscription,
  fetchPushConfig,
  putPushSubscription,
  type PushConfig,
  type PushRegistration,
} from "../api/notifications-api";
import {
  clearRememberedSubscriptionId,
  clearRememberedSubscriptionIdsExcept,
  listRememberedOwnerIds,
  saveRememberedSubscriptionId,
} from "./subscription-memory";

/**
 * 通知を有効にする・止める・切り替える手順（設計書「通知の設定の画面」）。
 * Service Workerとブラウザの購読とAPIの登録を決められた順で進める。
 * 呼び出しはeffect以降（window・navigatorに触れる）。
 */

export type EnableOutcome =
  | { kind: "enabled" }
  /** 許可を求めたが許可されなかった（defaultのまま・denied）。 */
  | { kind: "not-granted" }
  /** 前の人の購読を解除できなかった。登録しない（F-10）。 */
  | { kind: "previous-owner-left" }
  /** 有効な購読が3台いっぱい（409 PUSH_LIMIT_REACHED）。 */
  | { kind: "limit-reached" }
  /** 環境が使えない、または鍵の設定が崩れている（503）。 */
  | { kind: "unavailable" }
  /** 通信・認証・ブラウザの手順の失敗。failureはAPIの失敗、なければnull。 */
  | { kind: "failed"; failure: ApiFailure | null };

export type DisableOutcome =
  | { kind: "disabled" }
  | { kind: "failed"; failure: ApiFailure };

const SERVICE_WORKER_PATH = "/sw.js";

/** base64url（パディング無し）をUint8Arrayにする。 */
function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = window.atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/**
 * 購読の`options.applicationServerKey`が今の公開鍵と同じか。
 * 比べられない（キーが載っていない実装）は違うものとして扱い、
 * 先に解除してから登録し直す。
 */
function hasSameApplicationServerKey(
  subscription: PushSubscription,
  publicVapidKey: string,
): boolean {
  const current = subscription.options.applicationServerKey;
  if (current === null || current === undefined) {
    return false;
  }
  const next = base64UrlToBytes(publicVapidKey);
  const currentBytes = new Uint8Array(current);
  if (currentBytes.length !== next.length) {
    return false;
  }
  return currentBytes.every((byte, index) => byte === next[index]);
}

/** ブラウザの購読から登録に使う値を取り出す。取れなければnull。 */
function registrationInput(
  subscription: PushSubscription,
  keyId: string,
): PushRegistration | null {
  const json = subscription.toJSON();
  const p256dh = json.keys?.p256dh ?? null;
  const auth = json.keys?.auth ?? null;
  if (subscription.endpoint === "" || p256dh === null || auth === null) {
    return null;
  }
  return {
    endpoint: subscription.endpoint,
    keys: { p256dh, auth },
    expirationTime: subscription.expirationTime,
    deviceLabel: deviceLabelFromUserAgent(navigator.userAgent),
    keyId,
  };
}

async function getBrowserSubscription(
  registration: ServiceWorkerRegistration,
): Promise<PushSubscription | null> {
  try {
    return await registration.pushManager.getSubscription();
  } catch {
    return null;
  }
}

/** ブラウザの購読を解除する。購読が無ければtrue。失敗はfalse。 */
async function unsubscribeBrowserSubscription(
  registration: ServiceWorkerRegistration,
): Promise<boolean> {
  try {
    const subscription = await registration.pushManager.getSubscription();
    if (subscription === null) {
      return true;
    }
    return await subscription.unsubscribe();
  } catch {
    return false;
  }
}

type RegisterOutcome =
  | { kind: "enabled"; subscriptionId: string }
  | { kind: "key-changed" }
  | { kind: "limit-reached" }
  | { kind: "unavailable" }
  | { kind: "failed"; failure: ApiFailure | null };

/**
 * 今の購読を確保してAPIに登録する。今の購読があり、その
 * `options.applicationServerKey`が今の公開鍵と違えば解除してから登録する
 * （違う鍵の購読が残ったままでは新しい鍵でsubscribeできない。F-73）。
 * 409 PUSH_KEY_CHANGEDは呼び出し側が鍵を取り直してやり直す。
 */
async function subscribeAndRegister(
  registration: ServiceWorkerRegistration,
  config: PushConfig,
): Promise<RegisterOutcome> {
  let subscription = await getBrowserSubscription(registration);
  if (
    subscription !== null &&
    !hasSameApplicationServerKey(subscription, config.publicVapidKey)
  ) {
    try {
      if (!(await subscription.unsubscribe())) {
        return { kind: "failed", failure: null };
      }
    } catch {
      return { kind: "failed", failure: null };
    }
    subscription = null;
  }
  if (subscription === null) {
    try {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToBytes(
          config.publicVapidKey,
        ) as BufferSource,
      });
    } catch {
      return { kind: "failed", failure: null };
    }
  }
  const input = registrationInput(subscription, config.keyId);
  if (input === null) {
    return { kind: "failed", failure: null };
  }
  return putPushSubscription(input).match<RegisterOutcome>(
    (registered) => ({ kind: "enabled", subscriptionId: registered.id }),
    (failure) => {
      if (failure.kind === "http" && failure.status === 409) {
        if (failure.code === "PUSH_KEY_CHANGED") {
          return { kind: "key-changed" };
        }
        if (failure.code === "PUSH_LIMIT_REACHED") {
          return { kind: "limit-reached" };
        }
      }
      if (failure.kind === "http" && failure.status === 503) {
        return { kind: "unavailable" };
      }
      return { kind: "failed", failure };
    },
  );
}

/**
 * 通知を有効にする（F-04）。Service Workerの登録 → 許可を求める →
 * 今の購読の鍵の確認 → subscribe → PUT。409 PUSH_KEY_CHANGEDなら
 * ブラウザの購読を解除し、公開鍵を取り直して1回だけやり直す（F-73）。
 *
 * 有効にする前に、覚えた購読IDの持ち主が今の利用者と違えばブラウザの
 * 購読を解除してから登録する。解除できなければ登録しない（F-10）。
 */
export async function enableDeviceNotifications(
  userId: string,
): Promise<EnableOutcome> {
  let registration: ServiceWorkerRegistration;
  try {
    registration = await navigator.serviceWorker.register(
      SERVICE_WORKER_PATH,
    );
    registration = await navigator.serviceWorker.ready;
  } catch {
    return { kind: "unavailable" };
  }

  // 別の人のログインへの切り替え（F-10）。記憶の持ち主が今の利用者と
  // 違えば、ブラウザの購読は前の人の宛先なので先に解除する。解除できない
  // まま登録すると前の人の通知がこの端末に出るため、解除できなければ
  // 登録しない。
  const hasForeignOwner = listRememberedOwnerIds().some(
    (ownerId) => ownerId !== userId,
  );
  if (hasForeignOwner) {
    if (!(await unsubscribeBrowserSubscription(registration))) {
      return { kind: "previous-owner-left" };
    }
    clearRememberedSubscriptionIdsExcept(userId);
  }

  let permission: NotificationPermission;
  try {
    permission = await window.Notification.requestPermission();
  } catch {
    return { kind: "unavailable" };
  }
  if (permission !== "granted") {
    return { kind: "not-granted" };
  }

  const configResult = await fetchPushConfig();
  if (configResult.isErr()) {
    const failure = configResult.error;
    if (failure.kind === "http" && failure.status === 503) {
      return { kind: "unavailable" };
    }
    return { kind: "failed", failure };
  }

  let outcome = await subscribeAndRegister(registration, configResult.value);
  if (outcome.kind === "key-changed") {
    // 鍵の入れ替えのあとの登録し直し。購読を解除し、公開鍵を取り直して
    // 1回だけやり直す。
    await unsubscribeBrowserSubscription(registration);
    const retryConfig = await fetchPushConfig();
    if (retryConfig.isErr()) {
      return { kind: "failed", failure: retryConfig.error };
    }
    outcome = await subscribeAndRegister(registration, retryConfig.value);
    if (outcome.kind === "key-changed") {
      return { kind: "failed", failure: null };
    }
  }

  if (outcome.kind === "enabled") {
    saveRememberedSubscriptionId(userId, outcome.subscriptionId);
  }
  return outcome;
}

/**
 * この端末の通知を止める（F-08）。APIで無効にしてからブラウザの購読を
 * 解除し、端末の記憶を消す。ブラウザの解除が失敗してもAPIでは止まって
 * いるので、止めた扱いにする。
 * ログアウトの前の解除はshared/push/unsubscribe-for-sign-out.ts。
 */
export async function disableDeviceNotifications(
  subscriptionId: string,
  userId: string,
): Promise<DisableOutcome> {
  const result = await deletePushSubscription(subscriptionId);
  if (result.isErr()) {
    return { kind: "failed", failure: result.error };
  }
  clearRememberedSubscriptionId(userId);
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (registration !== undefined) {
      await unsubscribeBrowserSubscription(registration);
    }
  } catch {
    // ブラウザの解除の失敗で止めた扱いは変えない。
  }
  return { kind: "disabled" };
}

/** ほかの端末の購読を止める（一覧の「止める」）。APIだけを無効にする。 */
export async function disableOtherDevice(
  subscriptionId: string,
): Promise<DisableOutcome> {
  const result = await deletePushSubscription(subscriptionId);
  if (result.isErr()) {
    return { kind: "failed", failure: result.error };
  }
  return { kind: "disabled" };
}
