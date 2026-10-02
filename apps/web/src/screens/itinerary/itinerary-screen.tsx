"use client";

import { BookOpenText, Plus, WifiSlash } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useState } from "react";
import { useMe, useSignOut } from "@/features/auth";
import {
  DateBar,
  nextPlanOf,
  nowLineIndexOf,
  PlanCard,
} from "@/features/plans";
import {
  FinishTripDialog,
  sendFinishTrip,
  sendStartTrip,
  TripEditSheet,
  TripHeader,
  TripMenu,
  useTrip,
  useTripItinerary,
  useTripMutation,
  type TripSaveState,
} from "@/features/trips";
import { ApiRequestError } from "@/shared/api/api-failure";
import {
  clearSelectedTripId,
  saveSelectedTripId,
} from "@/shared/browser/selected-trip-store";
import { takePendingToast } from "@/shared/lib/pending-toast";
import {
  formatLocalDate,
  formatRemaining,
  isLocalDateString,
  tokyoTimeOf,
} from "@/shared/lib/local-date";
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
import { StatusText } from "@/shared/ui/status-text";
import { Toast } from "@/shared/ui/toast";

type Layer = "menu" | "edit" | "finish";

/**
 * `/trips/{tripId}/itinerary` のしおり（08）。旅行ヘッダー・日付バー
 * （期間の日を並べ、選択は URL の `date` で再現）と予定の一覧。
 * `date` を省略するとサーバーの既定、期間外なら「旅行期間外です」。
 * 下部のタブは「しおり」だけ。開けた旅行はその人の「前回の旅行」
 * として保存する（F-23）。
 */
export function ItineraryScreen({
  tripId,
  date = null,
}: {
  tripId: string;
  /** URL の `date`（`YYYY-MM-DD`）。省略時は null（サーバー既定）。 */
  date?: string | null;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { state: meState, clear: clearMe } = useMe();
  const itinerary = useTripItinerary(tripId, date);
  const online = useOnlineStatus();
  const now = useNow();
  const [layer, setLayer] = useState<Layer | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [sheetExpired, setSheetExpired] = useState<boolean | null>(null);
  const [sheetNotAvailable, setSheetNotAvailable] = useState(false);

  const start = useTripMutation({
    tripId,
    send: sendStartTrip,
    onSucceeded: () => {
      setLayer(null);
      setToast("旅行を開始しました");
    },
  });
  const finish = useTripMutation({
    tripId,
    send: sendFinishTrip,
    onSucceeded: () => {
      setLayer(null);
      setToast("旅行を終了しました");
    },
  });
  const {
    signOut,
    pending: signOutPending,
    failed: signOutFailed,
  } = useSignOut();

  const userId = meState.status === "ready" ? meState.me.user.id : null;
  const displayName =
    meState.status === "ready" ? meState.me.user.displayName : null;

  const handleSignOut = async () => {
    if (await signOut(userId)) {
      // 前の利用者の業務データが残らないよう、キャッシュと利用者の表示、
      // 未表示のトーストを消す。
      takePendingToast();
      queryClient.clear();
      clearMe();
      router.replace("/sign-in");
    }
  };

  useEffect(() => {
    if (meState.status === "unauthenticated") {
      router.replace("/sign-in");
    }
  }, [meState.status, router]);

  // 別画面での保存成功を遷移先で 1 回だけ知らせる（追加・編集・移動・取りやめ）。
  useEffect(() => {
    const pending = takePendingToast();
    if (pending !== null) {
      setToast(pending);
    }
  }, []);

  const failure =
    itinerary.error instanceof ApiRequestError
      ? itinerary.error.failure
      : null;

  const period =
    itinerary.data !== undefined
      ? {
          startsOn: itinerary.data.trip.startsOn,
          endsOn: itinerary.data.trip.endsOn,
        }
      : null;

  // 期間外の日は 422（PLAN_OUTSIDE_TRIP_PERIOD）→「旅行期間外です」。
  // 開いていたときは再取得も同じ 422 で失敗するため、どちらも同じ表示にする。
  const outsidePeriod =
    failure !== null &&
    failure.kind === "http" &&
    failure.status === 422 &&
    failure.code === "PLAN_OUTSIDE_TRIP_PERIOD" &&
    date !== null &&
    isLocalDateString(date);

  // 期間外の表示に必要な期間だけを取りに行く（しおりが無ければ旅行を取る）。
  const tripQuery = useTrip(tripId, {
    enabled: outsidePeriod && period === null,
  });

  // 開けた旅行を「前回の旅行」として保存する。開けなくなった（403）なら消す。
  useEffect(() => {
    if (userId !== null && itinerary.data !== undefined) {
      saveSelectedTripId(userId, tripId);
    }
  }, [userId, itinerary.data, tripId]);

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

  // 書き込みが 403 / 404 で拒否されたら C-2。新しいキーで回避しない（07 §10）。
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

  if (itinerary.isPending) {
    return (
      <main>
        <Loading />
      </main>
    );
  }

  // 取得・再取得の 401 は、表示済みのデータがあっても業務データを隠して C-1。
  if (
    failure !== null &&
    failure.kind === "http" &&
    failure.status === 401
  ) {
    return (
      <main>
        <SessionExpired onGoToSignIn={() => router.push("/sign-in")} />
      </main>
    );
  }

  // 期間外の日（422 PLAN_OUTSIDE_TRIP_PERIOD）は読み取りの失敗ではなく
  // 画面の状態なので、FetchFailed より先に切り替える。期間の取得に使う
  // 旅行の読み取りにも同じ出し分け（401 → C-1、403 / 404 → C-2）を適用する。
  if (outsidePeriod) {
    if (tripQuery.isPending) {
      return (
        <main>
          <Loading />
        </main>
      );
    }
    const tripFailure =
      tripQuery.error instanceof ApiRequestError
        ? tripQuery.error.failure
        : null;
    if (tripQuery.data === undefined) {
      if (tripFailure !== null && tripFailure.kind === "http") {
        if (tripFailure.status === 401) {
          return (
            <main>
              <SessionExpired
                onGoToSignIn={() => router.push("/sign-in")}
              />
            </main>
          );
        }
        if (tripFailure.status === 403 || tripFailure.status === 404) {
          return (
            <main>
              <NotAvailable
                target="trip"
                onGoToTrips={() => router.push("/trips")}
              />
            </main>
          );
        }
      }
      return (
        <main>
          <FetchFailed onRetry={() => void tripQuery.refetch()} />
        </main>
      );
    }
  }

  if (failure !== null && itinerary.data === undefined && !outsidePeriod) {
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
        <FetchFailed onRetry={() => void itinerary.refetch()} />
      </main>
    );
  }

  const data = itinerary.data;
  // 期間外はしおりの応答が無いので、旅行の問い合わせの結果を使う。
  const trip = data !== undefined ? data.trip : tripQuery.data;
  if (data === undefined && trip === undefined) {
    return (
      <main>
        <FetchFailed onRetry={() => void itinerary.refetch()} />
      </main>
    );
  }
  if (trip === undefined) {
    return (
      <main>
        <FetchFailed onRetry={() => void tripQuery.refetch()} />
      </main>
    );
  }

  const etag = `"${trip.version}"`;
  const plans = data !== undefined ? data.plans : null;

  // 「今 · 次まで」の線と次の予定の強調。表示中の日が日本時間の
  // 今日で、次の予定がある日だけ。線の位置は今の時刻の位置
  // （時刻が今以降のいちばん早い行の直前）。
  const next =
    now !== null && plans !== null ? nextPlanOf(plans, now) : null;
  const nowIndex =
    now !== null && plans !== null ? nowLineIndexOf(plans, now) : -1;

  const openMenu = () => {
    // 前回の拒否・競合は開き直したときに持ち越さない（結果不明は残す）。
    start.backToEditing();
    setLayer("menu");
  };

  return (
    <main className="itinerary-page">
      {!online && (
        <OfflineBanner
          at={data !== undefined ? new Date(data.fetchedAt) : null}
        />
      )}
      {data !== undefined && itinerary.isRefetchError && (
        <RefetchFailed
          fetchedAt={new Date(data.fetchedAt)}
          onRetry={() => void itinerary.refetch()}
        />
      )}
      {itinerary.isRefetching && <Refetching />}
      <TripHeader trip={trip} onOpenMenu={openMenu} />
      <DateBar
        tripId={tripId}
        startsOn={trip.startsOn}
        endsOn={trip.endsOn}
        selectedDate={data !== undefined ? data.date : null}
        finished={trip.status === "finished"}
      />
      {data === undefined ? (
        <section className="itinerary-outside">
          <StatusText>{`「${formatLocalDate(date ?? "")}」は旅行期間の外です。期間の日を選んでください。`}</StatusText>
        </section>
      ) : (
        <section className="itinerary-list">
          <header className="itinerary-list-head">
            <span className="itinerary-list-title">
              <span className="tabular-nums">
                {formatLocalDate(data.date)}
              </span>{" "}
              <span className="itinerary-list-count tabular-nums">
                {plans?.length ?? 0} 件
              </span>
            </span>
            <Link
              className="itinerary-list-add"
              href={`/trips/${tripId}/plans/new?date=${data.date}`}
            >
              <Plus size={14} weight="bold" aria-hidden="true" />
              予定を追加
            </Link>
          </header>
          {plans === null || plans.length === 0 ? (
            <p className="itinerary-list-empty">
              この日の予定はまだありません
            </p>
          ) : (
            <ul className="itinerary-list-items">
              {plans.map((plan, index) => (
                <Fragment key={plan.id}>
                  {index === nowIndex && now !== null && next !== null && (
                    <li className="plan-now">
                      <span className="plan-now-time tabular-nums">
                        {tokyoTimeOf(now)}
                      </span>
                      <span className="plan-now-marker" aria-hidden="true">
                        <span className="plan-now-dash" />
                        <span className="plan-now-dot" />
                      </span>
                      <span className="plan-now-label">
                        {`今 · 次まで ${formatRemaining(next.remainingMinutes)}`}
                      </span>
                    </li>
                  )}
                  <li>
                    <PlanCard
                      tripId={tripId}
                      plan={plan}
                      from={data.date}
                      meId={userId}
                      meName={displayName}
                      last={index === plans.length - 1}
                      next={next !== null && plan.id === next.plan.id}
                    />
                  </li>
                </Fragment>
              ))}
            </ul>
          )}
        </section>
      )}
      {layer === "menu" && (
        <TripMenu
          trip={trip}
          etag={etag}
          displayName={displayName}
          start={start}
          onEdit={() => setLayer("edit")}
          onRequestFinish={() => {
            finish.backToEditing();
            setLayer("finish");
          }}
          onSwitch={() => router.push("/trips")}
          onSignOut={() => void handleSignOut()}
          signOutPending={signOutPending}
          signOutFailed={signOutFailed}
          onClose={() => {
            // 拒否のあとに開き直すときは、取り直した最新の ETag で送る。
            if (start.state.status === "rejected") {
              void itinerary.refetch();
            }
            setLayer(null);
          }}
        />
      )}
      {layer === "edit" && (
        <TripEditSheet
          trip={trip}
          etag={etag}
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
          onClose={() => {
            if (finish.state.status === "rejected") {
              void itinerary.refetch();
            }
            setLayer(null);
          }}
        />
      )}
      {toast !== null && (
        <Toast message={toast} onDismiss={() => setToast(null)} />
      )}
      {/* 下部の主ボタン「支払いを記録」（v3 11。オフラインは灰色の固定表示）。 */}
      {online ? (
        <Link
          className="main-action"
          href={`/trips/${tripId}/payments/new`}
        >
          <Plus size={20} weight="bold" aria-hidden="true" />
          支払いを記録
        </Link>
      ) : (
        <span className="main-action main-action-offline" aria-disabled="true">
          <WifiSlash size={18} weight="bold" aria-hidden="true" />
          支払いを記録
        </span>
      )}
      <nav className="tabbar" aria-label="タブ">
        <div className="tabbar-inner">
          <span className="tabbar-item tabbar-item-current" aria-current="page">
            <BookOpenText size={18} weight="fill" aria-hidden="true" />
            しおり
          </span>
        </div>
      </nav>
    </main>
  );
}
