"use client";

import { BookOpenText } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useMe, useSignOut } from "@/features/auth";
import { NotificationGuideCard } from "@/features/notifications";
import { usePayments } from "@/features/payments";
import { usePlanNames } from "@/features/plans";
import { useBalance } from "@/features/settlement";
import {
  FINISH_TRIP_OPERATION,
  FinishTripDialog,
  sendFinishTrip,
  sendStartTrip,
  START_TRIP_OPERATION,
  TripEditSheet,
  TripMenu,
  TripTabBar,
  useHome,
  useTripMutation,
  type TripSaveState,
} from "@/features/trips";
import { ApiRequestError } from "@/shared/api/api-failure";
import { usePendingRequestCheck } from "@/shared/browser/use-pending-request-check";
import {
  clearSelectedTripId,
  saveSelectedTripId,
} from "@/shared/browser/selected-trip-store";
import { formatLocalDate } from "@/shared/lib/local-date";
import { takePendingToast } from "@/shared/lib/pending-toast";
import { useNow } from "@/shared/lib/use-now";
import { FetchFailed } from "@/shared/ui/state/fetch-failed";
import { Loading } from "@/shared/ui/state/loading";
import { NotAvailable } from "@/shared/ui/state/not-available";
import { OfflineBanner } from "@/shared/ui/state/offline-banner";
import {
  RefetchFailed,
  Refetching,
} from "@/shared/ui/state/refetch-failed";
import { SessionExpired } from "@/shared/ui/state/session-expired";
import { useOnlineStatus } from "@/shared/ui/state/use-online-status";
import { Toast } from "@/shared/ui/toast";
import { HomeBalanceCard } from "./home-balance-card";
import { HomeHeader } from "./home-header";
import { HomeRecordsCard } from "./home-records-card";
import { HomeScheduleCard } from "./home-schedule-card";

type Layer = "menu" | "edit" | "finish";

/**
 * `/trips/{tripId}/home`のホーム（04・18・19）。表示の種類はAPIの
 * `context`をそのまま使う（出発前・期間中・期間が過ぎた・終了後）。
 * 欄ごとの失敗はその欄だけに出し、全体の失敗は今ある状態の表示
 * （401→セッション切れ、403・404→開けない、その他→取得失敗）。
 * 開けた旅行はその人の「前回の旅行」として保存する（F-23）。
 * 下部のタブは共通の下のタブ（TripTabBar）。
 */
export function HomeScreen({ tripId }: { tripId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { state: meState, clear: clearMe } = useMe();
  const home = useHome(tripId);
  const online = useOnlineStatus();
  const now = useNow();
  const [layer, setLayer] = useState<Layer | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [sheetExpired, setSheetExpired] = useState<boolean | null>(null);
  const [sheetNotAvailable, setSheetNotAvailable] = useState(false);

  const me = meState.status === "ready" ? meState.me : null;
  const userId = me?.user.id ?? null;
  const displayName = me?.user.displayName ?? null;

  // 参加者の名前（「A から B へ」と記録の「〜 が〜」）。公開APIで参加者の
  // 一覧を返す道は残額だけなので、ホームが取れたあと残額も取る。
  const balance = useBalance(tripId, { enabled: home.data !== undefined });
  const participants = balance.data?.participants ?? null;

  // 案内のカードの「{相手}の記録」。取れなければカード側で「相手」と出す。
  const partnerName = useMemo(
    () =>
      participants?.find((participant) => participant.userId !== userId)
        ?.displayName ?? null,
    [participants, userId],
  );

  // 記録の行の名前。予定名は予定の欄の行から拾い、足りない分は予定を
  // 個別に引く。支払いの取り消しの行は支払いを引く（元の用途を出す）。
  const items = useMemo(() => {
    if (home.data === undefined || home.data.recentRecords.status !== "ok") {
      return [];
    }
    return home.data.recentRecords.data;
  }, [home.data]);
  const scheduleNames = useMemo(() => {
    const map = new Map<string, string>();
    const data = home.data?.schedule;
    if (data !== undefined && data.status === "ok" && data.data !== null) {
      for (const plan of data.data.items) {
        map.set(plan.id, plan.name);
      }
    }
    return map;
  }, [home.data]);
  const missingPlanIds = useMemo(() => {
    const ids = new Set<string>();
    for (const item of items) {
      if (
        item.kind !== "payment" &&
        item.kind !== "payment_cancellation" &&
        item.planId !== null &&
        !scheduleNames.has(item.planId)
      ) {
        ids.add(item.planId);
      }
    }
    return [...ids];
  }, [items, scheduleNames]);
  const cancelledPaymentIds = useMemo(() => {
    const ids = new Set<string>();
    for (const item of items) {
      if (item.kind === "payment_cancellation") {
        ids.add(item.id);
      }
    }
    return [...ids];
  }, [items]);
  const planNames = usePlanNames(tripId, missingPlanIds);
  const payments = usePayments(tripId, cancelledPaymentIds);
  const planNameOf = useMemo(
    () => (planId: string | null) =>
      planId === null
        ? null
        : (scheduleNames.get(planId) ?? planNames.get(planId) ?? null),
    [scheduleNames, planNames],
  );
  const paymentLabelOf = useMemo(
    () => (paymentId: string) =>
      payments.get(paymentId)?.label ?? null,
    [payments],
  );

  const startCheck = usePendingRequestCheck({
    userId,
    tripId,
    operation: START_TRIP_OPERATION,
  });
  const finishCheck = usePendingRequestCheck({
    userId,
    tripId,
    operation: FINISH_TRIP_OPERATION,
  });

  const start = useTripMutation({
    tripId,
    send: sendStartTrip,
    userId,
    check: startCheck.check,
    onSucceeded: () => {
      setLayer(null);
      setToast("旅行を開始しました");
    },
  });
  const finish = useTripMutation({
    tripId,
    send: sendFinishTrip,
    userId,
    check: finishCheck.check,
    onSucceeded: () => {
      setLayer(null);
      setToast("旅行を終了しました");
    },
  });
  const {
    signOut,
    pending: signOutPending,
    failure: signOutFailure,
  } = useSignOut();

  const handleSignOut = async () => {
    const result = await signOut(userId);
    if (result.ok) {
      // 前の利用者の業務データが残らないよう、キャッシュと利用者の表示、
      // 未表示のトーストを消す。
      takePendingToast();
      queryClient.clear();
      clearMe();
      // 通知を止められなかった（X-Push-Stopped: false）ときはログインの
      // 画面に案内を出す（F-65）。
      router.replace(
        result.pushStopped === false
          ? "/sign-in?notice=push-remaining"
          : "/sign-in",
      );
    }
  };

  useEffect(() => {
    if (meState.status === "unauthenticated") {
      router.replace("/sign-in");
    }
  }, [meState.status, router]);

  // 別画面での保存成功を遷移先で1回だけ知らせる。
  useEffect(() => {
    const pending = takePendingToast();
    if (pending !== null) {
      setToast(pending);
    }
  }, []);

  const failure =
    home.error instanceof ApiRequestError ? home.error.failure : null;

  // 開けた旅行を「前回の旅行」として保存する。開けなくなった（403）なら消す。
  useEffect(() => {
    if (userId !== null && home.data !== undefined) {
      saveSelectedTripId(userId, tripId);
    }
  }, [userId, home.data, tripId]);

  useEffect(() => {
    if (
      userId !== null &&
      failure !== null &&
      failure.kind === "http" &&
      failure.status === 403
    ) {
      clearSelectedTripId(userId);
    }
  }, [userId, failure]);

  const expired = [start.state, finish.state].find(
    (state): state is Extract<TripSaveState, { status: "session-expired" }> =>
      state.status === "session-expired",
  );
  if (expired !== undefined || sheetExpired !== null) {
    const unconfirmed = expired?.unconfirmed === true || sheetExpired === true;
    return (
      <main>
        <SessionExpired
          unconfirmedTarget={unconfirmed ? "旅行" : null}
          onGoToSignIn={() => router.push("/sign-in")}
        />
      </main>
    );
  }

  // 書き込みが403 / 404で拒否されたらC-2。新しいキーで回避しない（07 §10）。
  const writeNotAvailable = [start.state, finish.state].find(
    (state): state is Extract<TripSaveState, { status: "rejected" }> =>
      state.status === "rejected" &&
      (state.httpStatus === 403 || state.httpStatus === 404),
  );
  if (writeNotAvailable !== undefined || sheetNotAvailable) {
    return (
      <main>
        <NotAvailable
          target="trip"
          onGoToTrips={() => router.push("/trips")}
        />
      </main>
    );
  }

  if (home.isPending) {
    return (
      <main>
        <Loading />
      </main>
    );
  }

  // 取得・再取得の401は、表示済みのデータがあっても業務データを隠してC-1。
  if (failure !== null && failure.kind === "http" && failure.status === 401) {
    return (
      <main>
        <SessionExpired onGoToSignIn={() => router.push("/sign-in")} />
      </main>
    );
  }

  if (failure !== null && home.data === undefined) {
    if (
      failure.kind === "http" &&
      (failure.status === 403 || failure.status === 404)
    ) {
      return (
        <main>
          <NotAvailable
            target="trip"
            onGoToTrips={() => router.push("/trips")}
          />
        </main>
      );
    }
    return (
      <main>
        <FetchFailed onRetry={() => void home.refetch()} />
      </main>
    );
  }

  const data = home.data;
  if (data === undefined) {
    return (
      <main>
        <FetchFailed onRetry={() => void home.refetch()} />
      </main>
    );
  }

  const trip = data.trip;
  const etag = `"${trip.version}"`;
  const mode = data.context.mode;
  const showSchedule = mode === "before" || mode === "during";
  const showOrder = mode === "completed" || mode === "after_dates";

  const openMenu = () => {
    // 前回の拒否・競合は開き直したときに持ち越さない（結果不明は残す）。
    start.backToEditing();
    setLayer("menu");
  };

  return (
    <main className="home-page">
      {!online && <OfflineBanner at={new Date(data.fetchedAt)} />}
      {home.isRefetchError && (
        <RefetchFailed
          fetchedAt={new Date(data.fetchedAt)}
          onRetry={() => void home.refetch()}
        />
      )}
      {home.isRefetching && <Refetching />}
      <HomeHeader home={data} now={now} onOpenMenu={openMenu} />
      {/* 通知の案内のカード（F-15〜F-18）。出す条件はカードの中で判定する。 */}
      {userId !== null && (
        <NotificationGuideCard
          userId={userId}
          partnerName={partnerName}
          homePath={`/trips/${tripId}/home`}
        />
      )}
      {/* 期間が過ぎた（F-43）: 青いお知らせ帯を精算の欄の上に出す。
          旅行中なら「旅行を終了する」（今ある終了の確認へ）。
          計画中なら「開始してから終了する」の案内と開始のボタン。 */}
      {mode === "after_dates" && (
        <div className="banner banner-info home-banner">
          <span className="banner-text">
            <span className="banner-title">
              {`旅行の期間が終わりました（${formatLocalDate(trip.endsOn)} まで）`}
            </span>
            <span className="banner-body">
              {data.context.suggestedAction === "start"
                ? "この旅行はまだ開始していません。旅行を開始してから終了してください。"
                : "終了したあとも精算・編集はできます。"}
            </span>
            {data.context.suggestedAction === "finish" && (
              <button
                type="button"
                className="btn-ink home-banner-button"
                onClick={() => {
                  finish.backToEditing();
                  setLayer("finish");
                }}
              >
                旅行を終了する
              </button>
            )}
            {data.context.suggestedAction === "start" && (
              <button
                type="button"
                className="btn-ink home-banner-button"
                onClick={() => {
                  start.backToEditing();
                  setLayer("menu");
                }}
              >
                旅行を開始する
              </button>
            )}
          </span>
        </div>
      )}
      {/* 期間中でまだ開始していない日（F-42）:「旅行を開始」への案内。 */}
      {mode === "during" && data.context.suggestedAction === "start" && (
        <div className="banner banner-info home-banner">
          <span className="banner-text">
            <span className="banner-title">この旅行はまだ開始していません</span>
            <span className="banner-body">
              旅行を開始すると、記録や精算ができます。
            </span>
            <button
              type="button"
              className="btn-ink home-banner-button"
              onClick={() => {
                start.backToEditing();
                setLayer("menu");
              }}
            >
              旅行を開始する
            </button>
          </span>
        </div>
      )}
      {showSchedule ? (
        <HomeScheduleCard
          tripId={tripId}
          home={data}
          meId={userId}
          meName={displayName}
          now={now}
          onRetry={() => void home.refetch()}
        />
      ) : null}
      <HomeBalanceCard
        tripId={tripId}
        section={data.balance}
        participants={participants}
        me={me}
        onRetry={() => void home.refetch()}
      />
      <HomeRecordsCard
        tripId={tripId}
        section={data.recentRecords}
        participants={participants}
        me={me}
        planNameOf={planNameOf}
        paymentLabelOf={paymentLabelOf}
        onRetry={() => void home.refetch()}
      />
      {showOrder && (
        <Link className="home-guide" href={`/trips/${tripId}/itinerary`}>
          <BookOpenText size={18} weight="regular" aria-hidden="true" />
          しおりへ
        </Link>
      )}
      {layer === "menu" && (
        <TripMenu
          trip={trip}
          etag={etag}
          displayName={displayName}
          start={start}
          startPending={startCheck}
          onEdit={() => setLayer("edit")}
          onRequestFinish={() => {
            finish.backToEditing();
            setLayer("finish");
          }}
          onSwitch={() => router.push("/trips")}
          onSignOut={() => void handleSignOut()}
          signOutPending={signOutPending}
          signOutFailure={signOutFailure}
          onClose={() => {
            // 拒否のあとに開き直すときは、取り直した最新のETagで送る。
            if (start.state.status === "rejected") {
              void home.refetch();
            }
            setLayer(null);
          }}
        />
      )}
      {layer === "edit" && (
        <TripEditSheet
          trip={trip}
          etag={etag}
          userId={userId}
          onClose={() => setLayer(null)}
          onSaved={() => {
            setLayer(null);
            setToast("変更しました");
          }}
          onSessionExpired={(unconfirmed) => {
            setLayer(null);
            setSheetExpired(unconfirmed);
          }}
          onNotAvailable={() => {
            setLayer(null);
            setSheetNotAvailable(true);
          }}
        />
      )}
      {layer === "finish" && (
        <FinishTripDialog
          trip={trip}
          etag={etag}
          finish={finish}
          finishPending={finishCheck}
          onClose={() => {
            if (finish.state.status === "rejected") {
              void home.refetch();
            }
            setLayer(null);
          }}
        />
      )}
      {toast !== null && (
        <Toast message={toast} onDismiss={() => setToast(null)} />
      )}
      {/* 下部の主ボタン「支払いを記録」と4つのタブ（共通の部品）。 */}
      <TripTabBar tripId={tripId} current="home" />
    </main>
  );
}
