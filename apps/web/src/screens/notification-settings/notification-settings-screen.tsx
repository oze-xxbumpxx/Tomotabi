"use client";

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useMe } from "@/features/auth";
import {
  determineDeviceNotificationState,
  disableDeviceNotifications,
  disableOtherDevice,
  enableDeviceNotifications,
  isPushConfigUnavailable,
  loadRememberedSubscriptionId,
  readPushCapabilities,
  usePushConfig,
  usePushSubscriptions,
  type DeviceNotificationState,
  type PushCapabilities,
  type PushSubscription,
} from "@/features/notifications";
import { useBalance } from "@/features/settlement";
import { FetchFailed } from "@/shared/ui/state/fetch-failed";
import { Loading } from "@/shared/ui/state/loading";
import { SessionExpired } from "@/shared/ui/state/session-expired";
import { StatusText } from "@/shared/ui/status-text";

/** 「10月7日」の形にする（端末の行の小さな日付）。 */
function formatDeviceDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

/**
 * 通知の設定の画面（設計書「通知の設定の画面」。v3に無いので見本に沿う）。
 * 上に「この端末」のカード、下に「通知を受け取る端末（N / 3台）」の一覧。
 * `from`は許した旅行の中の経路だけ受け付ける（それ以外は旅行一覧に戻る）。
 */
export function NotificationSettingsScreen({
  backHref,
  tripId,
}: {
  /** 検証済みの戻る先（`/trips/{UUID}/...`または`/trips`）。 */
  backHref: string;
  /** `from`から取り出した旅行のID。無ければnull。 */
  tripId: string | null;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { state: meState } = useMe();
  const [caps, setCaps] = useState<PushCapabilities | null>(null);
  const [hasBrowserSubscription, setHasBrowserSubscription] = useState<
    boolean | null
  >(null);
  const [busy, setBusy] = useState(false);
  const [disablingId, setDisablingId] = useState<string | null>(null);
  const [flowMessage, setFlowMessage] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);

  const me = meState.status === "ready" ? meState.me : null;
  const userId = me?.user.id ?? null;

  // 「{相手}が予定や支払いを記録すると…」の名前。残額の参加者から
  // 自分以外を取る。取れなければ「相手」。
  const balance = useBalance(tripId ?? "", { enabled: tripId !== null });
  const partnerName = useMemo(() => {
    const participants = balance.data?.participants;
    if (participants === undefined || userId === null) {
      return null;
    }
    return (
      participants.find((participant) => participant.userId !== userId)
        ?.displayName ?? null
    );
  }, [balance.data, userId]);

  const config = usePushConfig({ enabled: userId !== null });
  const subscriptions = usePushSubscriptions({ enabled: userId !== null });

  useEffect(() => {
    if (meState.status === "unauthenticated") {
      router.replace("/sign-in");
    }
  }, [meState.status, router]);

  useEffect(() => {
    const next = readPushCapabilities();
    setCaps(next);
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
  }, []);

  const items = subscriptions.data ?? [];
  const rememberedId =
    userId === null ? null : loadRememberedSubscriptionId(userId);
  const currentRow =
    rememberedId === null
      ? null
      : (items.find((item) => item.id === rememberedId) ?? null);
  const deviceState: DeviceNotificationState | null =
    caps === null || hasBrowserSubscription === null
      ? null
      : determineDeviceNotificationState({
          iosNeedsHomeScreen: caps.iosNeedsHomeScreen,
          hasServiceWorker: caps.hasServiceWorker,
          hasPushManager: caps.hasPushManager,
          hasNotification: caps.hasNotification,
          permission: caps.permission,
          pushConfigUnavailable: isPushConfigUnavailable(config.error),
          hasBrowserSubscription,
          currentRow,
          hasCurrentSessionEnabledRow: items.some(
            (item) => item.isCurrentSession && item.enabled,
          ),
        });

  const refetchAll = async () => {
    await Promise.all([
      subscriptions.refetch(),
      config.refetch(),
      // queryClient経由でも取り直せるよう無効化しておく。
      queryClient.invalidateQueries({ queryKey: ["push-subscriptions"] }),
    ]);
  };

  const enable = async () => {
    if (userId === null) {
      return;
    }
    setBusy(true);
    setFlowMessage(null);
    const outcome = await enableDeviceNotifications(userId);
    setBusy(false);
    switch (outcome.kind) {
      case "enabled":
        // 許可・購読の状態を読み直して「有効」に切り替える。
        setCaps(readPushCapabilities());
        setHasBrowserSubscription(true);
        await refetchAll();
        break;
      case "not-granted":
        // 許可の答え（default/denied）を読み直して状態に反映する。
        setCaps(readPushCapabilities());
        break;
      case "previous-owner-left":
        setFlowMessage(
          "前に使っていた人の通知が残っています。電波のある所でもう一度お試しください",
        );
        break;
      case "limit-reached":
        setFlowMessage(
          "使える端末は3台までです。ほかの端末の行の「止める」で止めてから、もう一度登録してください。",
        );
        break;
      case "unavailable":
        setFlowMessage(
          "今は通知を使えません。時間をおいて、もう一度お試しください。",
        );
        void config.refetch();
        break;
      case "failed":
        if (
          outcome.failure?.kind === "http" &&
          outcome.failure.status === 401
        ) {
          setSessionExpired(true);
          break;
        }
        setFlowMessage("登録できませんでした。もう一度お試しください。");
        break;
    }
  };

  const stopThisDevice = async () => {
    // 止めるIDは今のendpointの有効な行から決める。記憶が無い・読めない
    // 端末でも止められるように、記憶はあとの順位にする。
    const stopId =
      items.find((item) => item.isCurrentSession && item.enabled)?.id ??
      rememberedId;
    if (userId === null || stopId === null) {
      return;
    }
    setBusy(true);
    setFlowMessage(null);
    const outcome = await disableDeviceNotifications(stopId, userId);
    setBusy(false);
    if (outcome.kind === "disabled") {
      setHasBrowserSubscription(false);
      await refetchAll();
      return;
    }
    if (outcome.failure.kind === "http" && outcome.failure.status === 401) {
      setSessionExpired(true);
      return;
    }
    setFlowMessage("止められませんでした。もう一度お試しください。");
  };

  const stopOtherDevice = async (subscriptionId: string) => {
    setDisablingId(subscriptionId);
    setFlowMessage(null);
    const outcome = await disableOtherDevice(subscriptionId);
    setDisablingId(null);
    if (outcome.kind === "disabled") {
      await subscriptions.refetch();
      return;
    }
    if (outcome.failure.kind === "http" && outcome.failure.status === 401) {
      setSessionExpired(true);
      return;
    }
    setFlowMessage("止められませんでした。もう一度お試しください。");
  };

  if (meState.status === "loading" || (userId !== null && deviceState === null && !subscriptions.isError)) {
    return (
      <main>
        <Loading />
      </main>
    );
  }

  if (meState.status === "unauthenticated" || sessionExpired) {
    return (
      <main>
        <SessionExpired onGoToSignIn={() => router.push("/sign-in")} />
      </main>
    );
  }

  if (meState.status === "unavailable" || meState.status === "error") {
    return (
      <main>
        <FetchFailed onRetry={() => router.refresh()} />
      </main>
    );
  }

  const enabledRows = items.filter((item) => item.enabled);
  const maxDevices = config.data?.maxActiveSubscriptions ?? 3;

  return (
    <main className="notify-page">
      <div className="notify-head">
        <Link className="plan-back" href={backHref} aria-label="戻る">
          ←
        </Link>
        <h1 className="page-title notify-title">この端末の通知</h1>
      </div>

      <section className="notify-card">
        <div className="notify-card-head">
          <h2 className="notify-card-title">この端末</h2>
          <span
            className={
              deviceState === "enabled"
                ? "notify-badge notify-badge-on"
                : "notify-badge notify-badge-off"
            }
          >
            {deviceState === "enabled" ? "有効" : "オフ"}
          </span>
        </div>
        <DeviceStateBody
          state={deviceState}
          partnerName={partnerName}
          busy={busy}
          onEnable={() => void enable()}
          onStop={() => void stopThisDevice()}
        />
        {flowMessage !== null && (
          <p role="alert" className="error">
            {flowMessage}
          </p>
        )}
      </section>

      <section className="notify-card">
        <h2 className="notify-card-title">
          通知を受け取る端末（{enabledRows.length} / {maxDevices}台）
        </h2>
        {subscriptions.isError ? (
          <FetchFailed
            message="端末の一覧を取得できませんでした"
            onRetry={() => void subscriptions.refetch()}
          />
        ) : enabledRows.length === 0 ? (
          <p className="notify-empty">登録されている端末はありません</p>
        ) : (
          <ul className="notify-rows">
            {enabledRows.map((item) => {
              const isThisDevice =
                item.isCurrentSession || item.id === rememberedId;
              return (
                <DeviceRow
                  key={item.id}
                  item={item}
                  isThisDevice={isThisDevice}
                  disabling={disablingId === item.id}
                  onStop={() => void stopOtherDevice(item.id)}
                />
              );
            })}
          </ul>
        )}
      </section>

      <p className="notify-note">
        ログアウトすると、この端末にはこれから送る通知が届かなくなります。
      </p>
    </main>
  );
}

function DeviceRow({
  item,
  isThisDevice,
  disabling,
  onStop,
}: {
  item: PushSubscription;
  isThisDevice: boolean;
  disabling: boolean;
  onStop: () => void;
}) {
  return (
    <li className="notify-row">
      <span className="notify-row-main">
        <span className="notify-row-label">{item.deviceLabel}</span>
        <span className="notify-row-sub">
          {isThisDevice
            ? `この端末 · ${formatDeviceDate(item.updatedAt)}`
            : formatDeviceDate(item.updatedAt)}
        </span>
      </span>
      {!isThisDevice && (
        <button
          type="button"
          className="notify-row-stop"
          disabled={disabling}
          onClick={onStop}
        >
          {disabling ? "止めています" : "止める"}
        </button>
      )}
    </li>
  );
}

/** 「この端末」のカードの状態ごとの説明と操作。 */
function DeviceStateBody({
  state,
  partnerName,
  busy,
  onEnable,
  onStop,
}: {
  state: DeviceNotificationState | null;
  partnerName: string | null;
  busy: boolean;
  onEnable: () => void;
  onStop: () => void;
}) {
  const partner = partnerName ?? "相手";
  switch (state) {
    case null:
      return <StatusText>読み込み中です</StatusText>;
    case "needs-home-screen-app":
      return (
        <p className="notify-card-body">
          Safariの共有ボタンから「ホーム画面に追加」を選び、追加したアイコンから開いてください。ホーム画面から開いたときだけ通知が使えます。
        </p>
      );
    case "unavailable":
      return (
        <p className="notify-card-body">
          この端末では通知が使えません。
        </p>
      );
    case "denied":
      return (
        <p className="notify-card-body">
          ブラウザやこの端末の設定で、通知が「許可しない」になっています。通知を使うには、ブラウザの設定からこのサイトの通知を許可してください。
        </p>
      );
    case "browser-only":
      return (
        <>
          <p className="notify-card-body">
            このブラウザでは登録していますが、登録の記録がサーバーにありません。もう一度登録し直してください。
          </p>
          <button
            type="button"
            className="btn-ink"
            disabled={busy}
            onClick={onEnable}
          >
            {busy ? "登録しています" : "登録し直す"}
          </button>
        </>
      );
    case "enabled":
      return (
        <>
          <p className="notify-card-body">
            {partner}が予定や支払いを記録すると、この端末に通知が届きます。名前や旅行の名前は出ますが、金額や場所は出ません。
          </p>
          <button
            type="button"
            className="btn-secondary"
            disabled={busy}
            onClick={onStop}
          >
            {busy ? "止めています" : "この端末の通知を止める"}
          </button>
        </>
      );
    case "api-disabled":
      return (
        <>
          <p className="notify-card-body">
            この端末の通知はサーバーで止められています。もう一度使うには登録し直してください。
          </p>
          <button
            type="button"
            className="btn-ink"
            disabled={busy}
            onClick={onEnable}
          >
            {busy ? "登録しています" : "登録し直す"}
          </button>
        </>
      );
    case "not-enabled":
      return (
        <>
          <p className="notify-card-body">
            {partner}が予定や支払いを記録したとき、アプリを開いていなくても知らせます。押すと、ブラウザが通知の許可を求めます。
          </p>
          <button
            type="button"
            className="btn-ink"
            disabled={busy}
            onClick={onEnable}
          >
            {busy ? "登録しています" : "通知を有効にする"}
          </button>
        </>
      );
  }
}
