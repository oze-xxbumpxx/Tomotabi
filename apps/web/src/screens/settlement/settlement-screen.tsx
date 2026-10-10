"use client";

import { ArrowsLeftRight } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useMe } from "@/features/auth";
import {
  BalanceBreakdown,
  createSettlementPreviewDraft,
  PendingPreviewList,
  SettlementHistory,
  TargetItemList,
  TransferCard,
  useBalance,
  useCreateSettlementPreview,
  usePendingSettlementPreviews,
  useSettlements,
} from "@/features/settlement";
import { TripTabBar } from "@/features/trips";
import { ApiRequestError } from "@/shared/api/api-failure";
import { usePendingRequestCheck } from "@/shared/browser/use-pending-request-check";
import { takePendingToast } from "@/shared/lib/pending-toast";
import { FetchFailed } from "@/shared/ui/state/fetch-failed";
import { Loading } from "@/shared/ui/state/loading";
import { NotAvailable } from "@/shared/ui/state/not-available";
import { OfflineBanner } from "@/shared/ui/state/offline-banner";
import { SaveUnknown } from "@/shared/ui/state/save-unknown";
import { SessionExpired } from "@/shared/ui/state/session-expired";
import { StorageUnavailable } from "@/shared/ui/state/storage-unavailable";
import { useOnlineStatus } from "@/shared/ui/state/use-online-status";
import { StatusText } from "@/shared/ui/status-text";
import { Toast } from "@/shared/ui/toast";

function failureOf(error: unknown) {
  return error instanceof ApiRequestError ? error.failure : null;
}

function isAuthFailure(error: unknown): boolean {
  const failure = failureOf(error);
  return (
    failure !== null && failure.kind === "http" && failure.status === 401
  );
}

function isNotAvailableFailure(error: unknown): boolean {
  const failure = failureOf(error);
  return (
    failure !== null &&
    failure.kind === "http" &&
    (failure.status === 403 || failure.status === 404)
  );
}

/**
 * `/trips/{tripId}/settlement`の精算（v3の14・14f・14g・14i）。
 * 残額・内訳・対象の明細・自分の未完了の確認・精算の履歴を欄ごとに出す。
 * 「受け渡しを確認する」はその時点の対象と金額を固定した確認を作り、
 * 受け渡しの確認の画面へ進む。作成は保留中の要求を通す（ADR-0006）。
 */
export function SettlementScreen({
  tripId,
  focusSettlementId = null,
}: {
  tripId: string;
  /** 通知から開いた精算の1件。履歴にあれば目立たせてスクロールする（F-52）。 */
  focusSettlementId?: string | null;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { state: meState } = useMe();
  const online = useOnlineStatus();
  const balance = useBalance(tripId);
  const previews = usePendingSettlementPreviews(tripId);
  const settlements = useSettlements(tripId);
  const [toast, setToast] = useState<string | null>(null);

  const userId = meState.status === "ready" ? meState.me.user.id : null;

  const { check, reload } = usePendingRequestCheck({
    userId,
    tripId,
    operation: "createSettlementPreview",
  });
  const create = useCreateSettlementPreview({
    userId,
    tripId,
    check,
    onSucceeded: (result) => {
      router.push(
        `/trips/${tripId}/settlement/previews/${result.data.id}`,
      );
    },
  });

  // 別画面での保存成功を遷移先で1回だけ知らせる（精算の記録）。
  useEffect(() => {
    const pending = takePendingToast();
    if (pending !== null) {
      setToast(pending);
    }
  }, []);

  useEffect(() => {
    if (meState.status === "unauthenticated") {
      router.replace("/sign-in");
    }
  }, [meState.status, router]);

  // 確定した拒否のあとは残額と確認の一覧を取り直す
  // （対象0件で作れない等のとき画面が新しい状態になるように）。
  useEffect(() => {
    if (create.state.status === "rejected") {
      void queryClient.invalidateQueries({ queryKey: ["balance", tripId] });
      void queryClient.invalidateQueries({
        queryKey: ["settlement-previews", tripId],
      });
    }
  }, [create.state.status, queryClient, tripId]);

  // 通知から開いた精算（focusSettlementId）が、読み込み済みの頁に無い
  // ときは、見つかるか最後の頁に達するまで続きを取る（F-52）。
  useEffect(() => {
    if (focusSettlementId === null) {
      return;
    }
    const found = (settlements.data?.pages ?? []).some((page) =>
      page.items.some((item) => item.id === focusSettlementId),
    );
    if (
      !found &&
      settlements.hasNextPage &&
      !settlements.isFetchingNextPage
    ) {
      void settlements.fetchNextPage();
    }
  }, [focusSettlementId, settlements]);

  if (create.state.status === "session-expired") {
    return (
      <main>
        <SessionExpired
          unconfirmedTarget={create.state.unconfirmed ? "精算" : null}
          onGoToSignIn={() => router.push("/sign-in")}
        />
      </main>
    );
  }

  // 書き込みが403 / 404で拒否されたらC-2。新しいキーで回避しない。
  if (
    create.state.status === "rejected" &&
    (create.state.httpStatus === 403 || create.state.httpStatus === 404)
  ) {
    return (
      <main>
        <NotAvailable target="trip" onGoToTrips={() => router.push("/trips")} />
      </main>
    );
  }

  // 取得・再取得の401は、表示済みのデータがあっても業務データを隠してC-1。
  if (
    isAuthFailure(balance.error) ||
    isAuthFailure(previews.error) ||
    isAuthFailure(settlements.error)
  ) {
    return (
      <main>
        <SessionExpired onGoToSignIn={() => router.push("/sign-in")} />
      </main>
    );
  }

  // 残額が開けない（403 / 404）はC-2。他の欄の403 / 404も同じ扱い。
  if (
    isNotAvailableFailure(balance.error) ||
    isNotAvailableFailure(previews.error) ||
    isNotAvailableFailure(settlements.error)
  ) {
    return (
      <main>
        <NotAvailable target="trip" onGoToTrips={() => router.push("/trips")} />
      </main>
    );
  }

  if (
    balance.isPending &&
    previews.isPending &&
    settlements.isPending &&
    meState.status === "loading"
  ) {
    return (
      <main>
        <Loading />
      </main>
    );
  }

  /** 確認の作成の主操作。保留がある・確認中・確認できないあいだは新しい要求を送らない。 */
  const createAction = (label: string) => {
    if (check.status === "found") {
      return (
        <SaveUnknown
          confirming={create.state.status === "saving"}
          onConfirm={() =>
            void create.confirmRequest(check.record).then(reload)
          }
        />
      );
    }
    if (
      check.status === "unavailable" ||
      create.state.status === "storage-unavailable"
    ) {
      return <StorageUnavailable />;
    }
    if (create.state.status === "unknown") {
      return (
        <SaveUnknown
          onConfirm={() => void create.confirmWithSameRequest()}
        />
      );
    }
    return (
      <>
        {create.state.status === "rejected" && (
          <StatusText tone="error">
            確認を作成できませんでした。もう一度お試しください。
          </StatusText>
        )}
        <button
          type="button"
          className="btn-ink settle-action"
          disabled={
            check.status === "checking" ||
            create.state.status === "saving" ||
            create.state.status === "succeeded" ||
            !online
          }
          onClick={() =>
            void create.submit(createSettlementPreviewDraft(tripId))
          }
        >
          <ArrowsLeftRight size={16} weight="bold" aria-hidden="true" />
          {create.state.status === "saving" ? "確認を作成中" : label}
        </button>
      </>
    );
  };

  const balanceData = balance.data;
  const previewRows =
    previews.data?.pages.flatMap((page) => page.items) ?? [];
  const settlementRows =
    settlements.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <main className="settle-page">
      {!online && <OfflineBanner at={null} />}
      <h1 className="page-title">精算</h1>

      {balance.isPending ? (
        <Loading />
      ) : balanceData === undefined ? (
        <section className="settle-card">
          <FetchFailed
            message="精算額を取得できませんでした"
            onRetry={() => void balance.refetch()}
          />
        </section>
      ) : (
        <>
          <TransferCard
            participants={balanceData.participants}
            transfer={balanceData.transfer}
            targetCount={balanceData.targetCount}
            action={
              balanceData.targetCount === 0
                ? undefined
                : createAction(
                    balanceData.transfer.requiresTransfer
                      ? "受け渡しを確認する"
                      : "受け渡し不要の対象を確認する",
                  )
            }
          />
          {balanceData.targetCount > 0 && (
            <>
              <BalanceBreakdown
                participants={balanceData.participants}
                items={balanceData.items}
              />
              <TargetItemList
                items={balanceData.items}
                participants={balanceData.participants}
                title="明細"
              />
            </>
          )}
        </>
      )}

      {previews.isPending ? null : previews.data === undefined ? (
        <section className="settle-card">
          <FetchFailed
            message="未完了の確認を取得できませんでした"
            onRetry={() => void previews.refetch()}
          />
        </section>
      ) : (
        previewRows.length > 0 && (
          <>
            <PendingPreviewList
              tripId={tripId}
              previews={previewRows}
              participants={balanceData?.participants ?? []}
            />
            {previews.hasNextPage && (
              <button
                type="button"
                className="btn-secondary"
                disabled={previews.isFetchingNextPage}
                onClick={() => void previews.fetchNextPage()}
              >
                さらに読み込む
              </button>
            )}
          </>
        )
      )}

      {settlements.isPending ? null : settlements.data === undefined ? (
        <section className="settle-card">
          <FetchFailed
            message="精算の履歴を取得できませんでした"
            onRetry={() => void settlements.refetch()}
          />
        </section>
      ) : (
        <>
          <SettlementHistory
            settlements={settlementRows}
            participants={balanceData?.participants ?? []}
            focusSettlementId={focusSettlementId}
          />
          {settlements.hasNextPage && (
            <button
              type="button"
              className="btn-secondary"
              disabled={settlements.isFetchingNextPage}
              onClick={() => void settlements.fetchNextPage()}
            >
              さらに読み込む
            </button>
          )}
        </>
      )}

      {toast !== null && (
        <Toast message={toast} onDismiss={() => setToast(null)} />
      )}
      {/* 「支払いを記録」と4つのタブ（共通の部品）。 */}
      <TripTabBar tripId={tripId} current="settlement" />
    </main>
  );
}
