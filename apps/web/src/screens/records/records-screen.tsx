"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  actorNameOf,
  baseKindOf,
  CANCEL_ACHIEVEMENT_OPERATION,
  CANCEL_BOOKING_OPERATION,
  cancelAchievementDraft,
  cancelBookingDraft,
  eventOf,
  isOriginalOf,
  PlanEventSheet,
  RecordFilters,
  RecordList,
  sendCancelAchievement,
  sendCancelBooking,
  useCancelPlanEvent,
  useRecordItems,
  useRecords,
  type Event,
  type EventKind,
  type ListRecordsType,
  type RecordsFilter,
  type RecordFilterKey,
  type TimelineItem,
} from "@/features/records";
import { useBalance, usePayment } from "@/features/payments";
import { usePlan } from "@/features/plans";
import { TripTabBar, useTrip } from "@/features/trips";
import { useMe } from "@/features/auth";
import { ApiRequestError } from "@/shared/api/api-failure";
import { usePendingRequestCheck } from "@/shared/browser/use-pending-request-check";
import { useNow } from "@/shared/lib/use-now";
import { FetchFailed } from "@/shared/ui/state/fetch-failed";
import { Loading } from "@/shared/ui/state/loading";
import { NotAvailable } from "@/shared/ui/state/not-available";
import { OfflineBanner } from "@/shared/ui/state/offline-banner";
import { SaveUnknown } from "@/shared/ui/state/save-unknown";
import { SessionExpired } from "@/shared/ui/state/session-expired";
import { StorageUnavailable } from "@/shared/ui/state/storage-unavailable";
import { StatusText } from "@/shared/ui/status-text";
import { Toast } from "@/shared/ui/toast";
import { useOnlineStatus } from "@/shared/ui/state/use-online-status";

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

/** 行を押して開く小さな詳細。取り消しの行は元の記録を取ってから出す。 */
type SheetOpen =
  | { kind: EventKind; recordId: string; planId: string | null; event: Event }
  | {
      kind: EventKind;
      recordId: string;
      planId: string | null;
      event: null;
    };

/** 予定の名前（行・小さな詳細・確認に出す）。取れないあいだは汎用の名。 */
function PlanNameCell({ tripId, planId }: { tripId: string; planId: string }) {
  const plan = usePlan(tripId, planId);
  // 読み込み中に「予定」と出すと、そういう名前の予定に見えるので、
  // 取れるまでは「…」にする。取れなかったときだけ汎用の名を出す。
  if (plan.isPending) {
    return <span aria-label="読み込み中">…</span>;
  }
  return <>{plan.data?.name ?? "予定"}</>;
}

/** 支払いの名前（取り消しの行に出す）。取れないあいだは「支払い」。 */
function PaymentNameCell({
  tripId,
  paymentId,
}: {
  tripId: string;
  paymentId: string;
}) {
  const payment = usePayment(tripId, paymentId);
  return <>{payment.data?.label ?? "支払い"}</>;
}

/**
 * 記録の一覧（/trips/{tripId}/records）。
 * 「すべて・支払い・達成・予約」の絞り込み、`?planId=`の予定の絞り込み、
 * `?recordId=&recordType=`の「この記録に絞り込み」を出す（F-20〜F-23）。
 * 末尾に近づいたら次のページを読み、続きの取得に失敗したときは
 * 読み込んだ行を残したまま「もう一度読む」を出す（F-22）。
 */
export function RecordsScreen({
  tripId,
  type,
  planId,
  recordId,
  recordType,
}: {
  tripId: string;
  /** `?type=`の絞り込み（無効な値は呼び出し側で除く）。 */
  type: ListRecordsType | null;
  planId: string | null;
  /** 「この記録に絞り込み」の記録のID。recordTypeと組で使う。 */
  recordId: string | null;
  recordType: ListRecordsType | null;
}) {
  const tripQuery = useTrip(tripId);
  const tripName = tripQuery.data?.name ?? null;
  const router = useRouter();
  const { state: meState } = useMe();
  const online = useOnlineStatus();
  const now = useNow();
  const [toast, setToast] = useState<string | null>(null);

  const userId = meState.status === "ready" ? meState.me.user.id : null;
  const meName =
    meState.status === "ready" ? meState.me.user.displayName : null;

  // 「この記録に絞り込み」ではrecordTypeをtypeとして送る（契約上type必須）。
  const filter: RecordsFilter = useMemo(
    () => ({
      type: recordId !== null ? recordType : type,
      planId,
      recordId,
    }),
    [recordId, recordType, type, planId],
  );
  const records = useRecords(tripId, filter);
  const balance = useBalance(tripId);
  const participants = balance.data?.participants;

  const nameOfUser = (uid: string) =>
    actorNameOf(uid, participants, userId, meName);

  // 記録の取り消し（達成・予約）はこの画面の小さな詳細から始まるので、
  // その保留の照合もこの画面で行う（F-70・F-71）。
  const cancelAchievementPending = usePendingRequestCheck({
    userId,
    tripId,
    operation: CANCEL_ACHIEVEMENT_OPERATION,
  });
  const cancelBookingPending = usePendingRequestCheck({
    userId,
    tripId,
    operation: CANCEL_BOOKING_OPERATION,
  });
  const cancelAchievement = useCancelPlanEvent({
    tripId,
    planId: null,
    send: sendCancelAchievement,
    userId,
    check: cancelAchievementPending.check,
    onSucceeded: () => {
      setSheetOpen(null);
      setToast("取り消しました");
    },
  });
  const cancelBooking = useCancelPlanEvent({
    tripId,
    planId: null,
    send: sendCancelBooking,
    userId,
    check: cancelBookingPending.check,
    onSucceeded: () => {
      setSheetOpen(null);
      setToast("取り消しました");
    },
  });

  const [sheetOpen, setSheetOpen] = useState<SheetOpen | null>(null);

  // 取り消しの行を押したとき: 元の記録を取ってから小さな詳細を出す。
  const recordItems = useRecordItems(
    tripId,
    sheetOpen?.kind ?? "achievement",
    sheetOpen?.recordId ?? "",
    {
      enabled: sheetOpen !== null && sheetOpen.event === null,
    },
  );
  useEffect(() => {
    if (
      sheetOpen === null ||
      sheetOpen.event !== null ||
      recordItems.data === undefined
    ) {
      return;
    }
    const original = recordItems.data.find((item) =>
      isOriginalOf(item, sheetOpen.kind),
    );
    const resolved = original === undefined ? null : eventOf(original);
    if (resolved === null) {
      // 元の記録が見つからなければ小さな詳細は開かない。
      setSheetOpen(null);
      return;
    }
    setSheetOpen({ ...sheetOpen, event: resolved });
  }, [sheetOpen, recordItems.data]);

  // 末尾に近づいたら次のページを読む（F-22）。
  const sentinelRef = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } =
    records;
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined" || !hasNextPage) {
      return;
    }
    const el = sentinelRef.current;
    if (el === null) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void fetchNextPage();
        }
      },
      { rootMargin: "240px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchNextPageError, fetchNextPage]);

  const selectFilter = (key: RecordFilterKey) => {
    const params = new URLSearchParams();
    if (key !== "all") {
      params.set("type", key);
    }
    if (planId !== null) {
      params.set("planId", planId);
    }
    const query = params.toString();
    router.push(
      `/trips/${tripId}/records${query === "" ? "" : `?${query}`}`,
    );
  };

  const openItem = (item: TimelineItem) => {
    const event = eventOf(item);
    if (event !== null) {
      setSheetOpen({
        kind: event.kind,
        recordId: event.id,
        planId: event.planId,
        event,
      });
      return;
    }
    // 取り消しの行は元の記録の中身を開く。
    const baseKind = baseKindOf(item.kind);
    if (baseKind === "achievement" || baseKind === "booking") {
      setSheetOpen({
        kind: baseKind,
        recordId: item.targetId,
        planId: item.planId,
        event: null,
      });
    }
  };

  const items =
    records.data?.pages.flatMap((page) => page.items) ?? [];

  const todayKey = now === null ? null : todayLocalKey(now);

  // ---- C-1 / C-2 ----
  if (meState.status === "unauthenticated") {
    return (
      <main>
        <SessionExpired onGoToSignIn={() => router.push("/sign-in")} />
      </main>
    );
  }

  const writeExpired = [cancelAchievement.state, cancelBooking.state].find(
    (
      s,
    ): s is Extract<typeof s, { status: "session-expired" }> =>
      s.status === "session-expired",
  );
  if (
    writeExpired !== undefined ||
    isAuthFailure(records.error) ||
    isAuthFailure(balance.error)
  ) {
    return (
      <main>
        <SessionExpired
          unconfirmedTarget={
            writeExpired?.unconfirmed === true ? "記録" : null
          }
          onGoToSignIn={() => router.push("/sign-in")}
        />
      </main>
    );
  }

  const writeNotAvailable = [
    cancelAchievement.state,
    cancelBooking.state,
  ].find(
    (s): s is Extract<typeof s, { status: "rejected" }> =>
      s.status === "rejected" &&
      (s.httpStatus === 403 || s.httpStatus === 404),
  );
  if (
    writeNotAvailable !== undefined ||
    isNotAvailableFailure(records.error) ||
    isNotAvailableFailure(balance.error)
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

  const isRecordMode = recordId !== null && recordType !== null;
  const filtering = type !== null || planId !== null || isRecordMode;
  const emptyMessage = filtering
    ? "この条件の記録はありません"
    : "記録はまだありません";

  return (
    <main className="records-page">
      {!online && <OfflineBanner at={null} />}
      {/* v3の10: 見出しの上に旅行名 */}
      {tripName !== null && <p className="page-eyebrow">{tripName}</p>}
      <h1 className="page-title">記録</h1>

      {/* 送り直しの確認（この画面で始める操作の保留が残っていれば出す） */}
      {cancelAchievementPending.check.status === "found" && (
        <SaveUnknown
          onConfirm={() => {
            if (cancelAchievementPending.check.status !== "found") {
              return;
            }
            void cancelAchievement
              .confirmRequest(cancelAchievementPending.check.record)
              .then(cancelAchievementPending.reload);
          }}
          confirming={cancelAchievement.state.status === "saving"}
        />
      )}
      {cancelBookingPending.check.status === "found" && (
        <SaveUnknown
          onConfirm={() => {
            if (cancelBookingPending.check.status !== "found") {
              return;
            }
            void cancelBooking
              .confirmRequest(cancelBookingPending.check.record)
              .then(cancelBookingPending.reload);
          }}
          confirming={cancelBooking.state.status === "saving"}
        />
      )}
      {(cancelAchievementPending.check.status === "unavailable" ||
        cancelBookingPending.check.status === "unavailable") && (
        <StorageUnavailable />
      )}

      {/* 「この記録に絞り込み」・予定の絞り込みの案内 */}
      {isRecordMode && (
        <p className="record-banner">
          この記録に絞り込み中
          <Link className="record-banner-link" href={`/trips/${tripId}/records`}>
            すべての記録へ
          </Link>
        </p>
      )}
      {!isRecordMode && planId !== null && (
        <p className="record-banner">
          <PlanNameCell tripId={tripId} planId={planId} />
          の記録に絞り込み中
          <Link className="record-banner-link" href={`/trips/${tripId}/records`}>
            すべての記録へ
          </Link>
        </p>
      )}

      {!isRecordMode && (
        <RecordFilters
          current={type ?? "all"}
          onSelect={selectFilter}
        />
      )}

      {records.isPending ? (
        <Loading />
      ) : records.data === undefined ? (
        <section className="record-card">
          <FetchFailed
            message="記録を取得できませんでした"
            onRetry={() => void records.refetch()}
          />
        </section>
      ) : items.length === 0 ? (
        <div className="record-empty">
          <p className="record-empty-text">{emptyMessage}</p>
          {filtering && (
            <Link
              className="btn-secondary record-empty-clear"
              href={`/trips/${tripId}/records`}
            >
              絞り込みを解除
            </Link>
          )}
        </div>
      ) : (
        <>
          <RecordList
            tripId={tripId}
            items={items}
            actorNameOf={nameOfUser}
            resolvers={{
              planName: (id) => (
                <PlanNameCell tripId={tripId} planId={id} />
              ),
              paymentName: (id) => (
                <PaymentNameCell tripId={tripId} paymentId={id} />
              ),
            }}
            todayKey={todayKey}
            onOpenEvent={openItem}
          />
          {/* 続きの読み込み（IntersectionObserver）。失敗時は行を残して「もう一度読む」 */}
          {hasNextPage && (
            <div ref={sentinelRef} className="record-more">
              {isFetchNextPageError ? (
                <>
                  <StatusText tone="error">
                    続きを読み込めませんでした
                  </StatusText>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => void fetchNextPage()}
                  >
                    もう一度読む
                  </button>
                </>
              ) : (
                <span className="record-more-label">
                  {isFetchingNextPage ? "読み込み中" : ""}
                </span>
              )}
            </div>
          )}
          {typeof IntersectionObserver === "undefined" && hasNextPage && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => void fetchNextPage()}
            >
              さらに読み込む
            </button>
          )}
        </>
      )}

      {sheetOpen !== null && (
        <PlanEventSheet
          tripId={tripId}
          event={sheetOpen.event}
          actorNameOf={nameOfUser}
          planName={(id) => <PlanNameCell tripId={tripId} planId={id} />}
          cancel={
            sheetOpen.kind === "achievement"
              ? {
                  save: cancelAchievement,
                  pending: cancelAchievementPending,
                  draft: (recordIdToCancel) =>
                    cancelAchievementDraft(tripId, recordIdToCancel),
                }
              : {
                  save: cancelBooking,
                  pending: cancelBookingPending,
                  draft: (recordIdToCancel) =>
                    cancelBookingDraft(tripId, recordIdToCancel),
                }
          }
          onClose={() => setSheetOpen(null)}
          onSessionExpired={() => {}}
          onNotAvailable={() => {}}
        />
      )}

      {toast !== null && (
        <Toast message={toast} onDismiss={() => setToast(null)} />
      )}
      <TripTabBar tripId={tripId} current="records" />
    </main>
  );
}

/** 端末のローカル日を`YYYY-MM-DD`で返す（「今日」の印用）。 */
function todayLocalKey(now: Date): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
