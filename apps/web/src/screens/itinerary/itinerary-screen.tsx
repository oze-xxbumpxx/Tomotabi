"use client";

import { BookOpenText } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useMe, useSignOut } from "@/features/auth";
import {
  FinishTripDialog,
  sendFinishTrip,
  sendStartTrip,
  TripEditSheet,
  TripHeader,
  TripMenu,
  useTripItinerary,
  useTripMutation,
  type TripSaveState,
} from "@/features/trips";
import { ApiRequestError } from "@/shared/api/api-failure";
import {
  clearSelectedTripId,
  saveSelectedTripId,
} from "@/shared/browser/selected-trip-store";
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

type Layer = "menu" | "edit" | "finish";

/**
 * `/trips/{tripId}/itinerary` のしおり。M2-c2 ではヘッダーと「準備中」だけ
 * （日付バーと予定の一覧は M2-d でここに入る）。下部のタブは「しおり」だけ。
 * 開けた旅行はその人の「前回の旅行」として保存する（F-23）。
 */
export function ItineraryScreen({ tripId }: { tripId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { state: meState, clear: clearMe } = useMe();
  const itinerary = useTripItinerary(tripId);
  const online = useOnlineStatus();
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
      // 前の利用者の業務データが残らないよう、キャッシュと利用者の表示を消す。
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

  const failure =
    itinerary.error instanceof ApiRequestError
      ? itinerary.error.failure
      : null;

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

  if (failure !== null && itinerary.data === undefined) {
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
  if (data === undefined) {
    return (
      <main>
        <FetchFailed onRetry={() => void itinerary.refetch()} />
      </main>
    );
  }

  const trip = data.trip;
  const etag = `"${trip.version}"`;

  const openMenu = () => {
    // 前回の拒否・競合は開き直したときに持ち越さない（結果不明は残す）。
    start.backToEditing();
    setLayer("menu");
  };

  return (
    <main className="itinerary-page">
      {!online && <OfflineBanner at={new Date(data.fetchedAt)} />}
      {itinerary.isRefetchError && (
        <RefetchFailed
          fetchedAt={new Date(data.fetchedAt)}
          onRetry={() => void itinerary.refetch()}
        />
      )}
      {itinerary.isRefetching && <Refetching />}
      <TripHeader trip={trip} onOpenMenu={openMenu} />
      <section className="itinerary-stub">
        <p>しおりは準備中です。</p>
        <p className="itinerary-stub-note">
          予定の一覧は今後のリリースで追加されます。
        </p>
      </section>
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
