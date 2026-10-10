"use client";

import { Bell } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { determineDeviceNotificationState } from "../model/device-state";
import { isPushConfigUnavailable } from "../model/push-config-unavailable";
import {
  usePushConfig,
  usePushSubscriptions,
} from "../model/notification-queries";
import {
  readPushCapabilities,
  type PushCapabilities,
} from "../model/push-capabilities";
import { enableDeviceNotifications } from "../model/push-flow";
import {
  loadGuideDismissed,
  loadRememberedSubscriptionId,
  saveGuideDismissed,
} from "../model/subscription-memory";

/**
 * ホームの上部に出す案内のカード（F-15〜F-18）。
 * 出す条件: 使える環境で、許可を断っておらず、この端末が有効でなく、
 * この端末・この人で閉じていない。閉じたことはlocalStorageに利用者の
 * IDつきで覚え、読めなければ出す。
 * 「通知を有効にする」は設定の画面と同じ手順をその場で走らせる。
 * iPhoneでホーム画面への追加が要るときは設定の画面へ移る（F-16）。
 */
export function NotificationGuideCard({
  userId,
  partnerName,
  homePath,
}: {
  userId: string;
  /** 「{相手}の記録を通知で受け取る」の名前。取れなければ「相手」。 */
  partnerName: string | null;
  /** 旅行のホームの経路（設定の画面へ移るときの`from`）。 */
  homePath: string;
}) {
  const router = useRouter();
  const [caps, setCaps] = useState<PushCapabilities | null>(null);
  const [hasBrowserSubscription, setHasBrowserSubscription] = useState<
    boolean | null
  >(null);
  const [dismissed, setDismissed] = useState(true);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // 使える環境でなければ一覧・設定は取りに行かない（出さないと決まっている）。
  const canUseEnvironment =
    caps !== null &&
    (caps.iosNeedsHomeScreen ||
      (caps.hasServiceWorker && caps.hasPushManager && caps.hasNotification));
  const eligible = canUseEnvironment && caps.permission !== "denied";

  const config = usePushConfig({ enabled: eligible });
  const subscriptions = usePushSubscriptions({ enabled: eligible });

  useEffect(() => {
    const next = readPushCapabilities();
    setCaps(next);
    setDismissed(loadGuideDismissed(userId));
    if (!(next.hasServiceWorker && next.hasPushManager)) {
      setHasBrowserSubscription(false);
      return;
    }
    let alive = true;
    navigator.serviceWorker
      .getRegistration()
      .then((registration) =>
        registration === undefined
          ? null
          : registration.pushManager.getSubscription(),
      )
      .then((subscription) => {
        if (alive) {
          setHasBrowserSubscription(subscription !== null);
        }
      })
      .catch(() => {
        if (alive) {
          setHasBrowserSubscription(false);
        }
      });
    return () => {
      alive = false;
    };
  }, [userId]);

  if (
    caps === null ||
    hasBrowserSubscription === null ||
    !eligible ||
    dismissed
  ) {
    return null;
  }

  const items = subscriptions.data ?? [];
  const rememberedId = loadRememberedSubscriptionId(userId);
  const state = determineDeviceNotificationState({
    iosNeedsHomeScreen: caps.iosNeedsHomeScreen,
    hasServiceWorker: caps.hasServiceWorker,
    hasPushManager: caps.hasPushManager,
    hasNotification: caps.hasNotification,
    permission: caps.permission,
    pushConfigUnavailable: isPushConfigUnavailable(config.error),
    hasBrowserSubscription,
    currentRow:
      rememberedId === null
        ? null
        : (items.find((item) => item.id === rememberedId) ?? null),
    hasCurrentSessionEnabledRow: items.some(
      (item) => item.isCurrentSession && item.enabled,
    ),
  });

  // 有効・使えない・許可を断った、は出さない（F-15・F-18）。
  if (
    state === "enabled" ||
    state === "unavailable" ||
    state === "denied"
  ) {
    return null;
  }
  // 一覧の取得を待っているあいだは出さない。
  if (subscriptions.isPending || config.isPending) {
    return null;
  }
  // 一覧を取れなければ「この端末が有効でない」が確かめられないので出さない。
  if (subscriptions.data === undefined) {
    return null;
  }

  const enable = async () => {
    // iPhoneでホーム画面への追加が要るときは設定の画面の手順へ進める（F-16）。
    if (caps.iosNeedsHomeScreen) {
      router.push(
        `/settings/notifications?from=${encodeURIComponent(homePath)}`,
      );
      return;
    }
    setBusy(true);
    setErrorMessage(null);
    const outcome = await enableDeviceNotifications(userId);
    setBusy(false);
    switch (outcome.kind) {
      case "enabled":
        void subscriptions.refetch();
        void config.refetch();
        setCaps(readPushCapabilities());
        setHasBrowserSubscription(true);
        break;
      case "not-granted":
        // 許可を断った端末ではカードを出さないので、状態を読み直して隠す。
        setCaps(readPushCapabilities());
        break;
      case "previous-owner-left":
        setErrorMessage(
          "前に使っていた人の通知が残っています。電波のある所でもう一度お試しください",
        );
        break;
      default:
        setErrorMessage(
          "通知を有効にできませんでした。もう一度お試しください。",
        );
        break;
    }
  };

  return (
    <section className="home-notify-card" aria-label="通知の案内">
      <div className="home-notify-head">
        <Bell size={22} weight="regular" aria-hidden="true" />
        <h2 className="home-notify-title">
          {partnerName ?? "相手"}の記録を通知で受け取る
        </h2>
      </div>
      <p className="home-notify-body">
        アプリを開いていなくても、予定や支払いの記録が届きます。
      </p>
      {errorMessage !== null && (
        <p role="alert" className="error">
          {errorMessage}
        </p>
      )}
      <div className="home-notify-actions">
        <button
          type="button"
          className="btn-ink home-notify-enable"
          disabled={busy}
          onClick={() => void enable()}
        >
          通知を有効にする
        </button>
        <button
          type="button"
          className="home-notify-dismiss"
          disabled={busy}
          onClick={() => {
            saveGuideDismissed(userId);
            setDismissed(true);
          }}
        >
          閉じる
        </button>
      </div>
    </section>
  );
}
