"use client";

import { Plus, SuitcaseRolling } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useMe } from "@/features/auth";
import { TripRow, useTripList } from "@/features/trips";
import { ApiRequestError } from "@/shared/api/api-failure";
import { loadSelectedTripId } from "@/shared/browser/selected-trip-store";
import { FetchFailed } from "@/shared/ui/state/fetch-failed";
import { Loading } from "@/shared/ui/state/loading";
import { OfflineBanner } from "@/shared/ui/state/offline-banner";
import { RefetchFailed, Refetching } from "@/shared/ui/state/refetch-failed";
import { SessionExpired } from "@/shared/ui/state/session-expired";
import { useOnlineStatus } from "@/shared/ui/state/use-online-status";

/**
 * `/trips`の旅行一覧（15のページ版。0件は19）。
 * 行を押すとその旅行のしおりへ。選択値の保存はしおり側で行う。
 * 一覧の初回の失敗は「取得できませんでした」、再取得の失敗は
 * 前回の表示に「更新できていません」を添える（失敗を0件にしない）。
 */
export function TripsScreen() {
  const router = useRouter();
  const { state: meState } = useMe();
  const trips = useTripList();
  const online = useOnlineStatus();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (meState.status === "unauthenticated") {
      router.replace("/sign-in");
    }
  }, [meState.status, router]);

  useEffect(() => {
    if (meState.status === "ready") {
      setSelectedId(loadSelectedTripId(meState.me.user.id));
    }
  }, [meState]);

  const failure =
    trips.error instanceof ApiRequestError ? trips.error.failure : null;

  // 取得・再取得の401は、表示済みのデータがあっても業務データを隠してC-1。
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

  const items = trips.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <main className="trips-page">
      <h1 className="page-title">旅行を切り替え</h1>
      {!online && (
        <OfflineBanner
          at={trips.data === undefined ? null : new Date(trips.dataUpdatedAt)}
        />
      )}
      {trips.isPending && <Loading />}
      {failure !== null && trips.data === undefined && (
        <FetchFailed onRetry={() => void trips.refetch()} />
      )}
      {trips.data !== undefined && (
        <>
          {trips.isRefetching && <Refetching />}
          {trips.isRefetchError && (
            <RefetchFailed
              fetchedAt={new Date(trips.dataUpdatedAt)}
              onRetry={() => void trips.refetch()}
            />
          )}
        </>
      )}
      {trips.data !== undefined && items.length === 0 && (
        <div className="empty-trips">
          <SuitcaseRolling size={44} aria-hidden="true" />
          <h2 className="empty-trips-title">旅行はまだありません</h2>
          <p className="empty-trips-body">
            旅行をつくると、しおり・記録・精算を使えるようになります。
          </p>
          <Link href="/trips/new" className="btn-ink">
            <Plus size={16} weight="bold" aria-hidden="true" />
            新しい旅行をつくる
          </Link>
        </div>
      )}
      {items.length > 0 && (
        <>
          <div className="trip-list-card">
            {items.map((trip) => (
              <TripRow
                key={trip.id}
                trip={trip}
                selected={trip.id === selectedId}
              />
            ))}
          </div>
          {trips.hasNextPage && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => void trips.fetchNextPage()}
              disabled={trips.isFetchingNextPage}
            >
              {trips.isFetchingNextPage ? "読み込み中" : "さらに読み込む"}
            </button>
          )}
          <Link href="/trips/new" className="btn-outline">
            <Plus size={16} weight="bold" aria-hidden="true" />
            新しい旅行をつくる
          </Link>
        </>
      )}
    </main>
  );
}
