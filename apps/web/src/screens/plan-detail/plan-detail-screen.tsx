"use client";

import {
  CalendarBlank,
  CalendarCheck,
  CaretLeft,
  CheckCircle,
  PencilSimple,
  Prohibit,
  Wallet,
} from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useMe } from "@/features/auth";
import {
  CANCEL_PLAN_OPERATION,
  CancelPlanDialog,
  MOVE_PLAN_OPERATION,
  PlanDetailBody,
  PlanMoveSheet,
  sendCancelPlan,
  sendMovePlan,
  usePlan,
  usePlanMutation,
  type PlanSave,
} from "@/features/plans";
import {
  actorNameOf,
  CREATE_ACHIEVEMENT_OPERATION,
  CREATE_BOOKING_OPERATION,
  createAchievementDraft,
  createBookingDraft,
  RecordRowView,
  sendCreateAchievement,
  sendCreateBooking,
  useCreatePlanEvent,
  usePlanPayments,
} from "@/features/records";
import { useBalance } from "@/features/payments";
import { TripTabBar, useTrip } from "@/features/trips";
import { ApiRequestError } from "@/shared/api/api-failure";
import type { SaveState } from "@/shared/api/save-state";
import { usePendingRequestCheck } from "@/shared/browser/use-pending-request-check";
import { Sheet } from "@/shared/ui/sheet";
import { takePendingToast } from "@/shared/lib/pending-toast";
import { isLocalDateString } from "@/shared/lib/local-date";
import { FetchFailed } from "@/shared/ui/state/fetch-failed";
import { Loading } from "@/shared/ui/state/loading";
import { NotAvailable } from "@/shared/ui/state/not-available";
import { OfflineBanner } from "@/shared/ui/state/offline-banner";
import {
  RefetchFailed,
  Refetching,
} from "@/shared/ui/state/refetch-failed";
import { SaveUnknown } from "@/shared/ui/state/save-unknown";
import { SessionExpired } from "@/shared/ui/state/session-expired";
import { StorageUnavailable } from "@/shared/ui/state/storage-unavailable";
import { useOnlineStatus } from "@/shared/ui/state/use-online-status";
import { StatusText } from "@/shared/ui/status-text";
import { Toast } from "@/shared/ui/toast";

type Layer = "move" | "cancel";

/** 達成を付けられる種類（取りやめた予定には付けられない）。 */
const ACHIEVABLE_KINDS: ReadonlyArray<string> = [
  "place",
  "food",
  "shopping",
];
/** 予約を付けられる種類（取りやめた予定にも付けられる）。 */
const BOOKABLE_KINDS: ReadonlyArray<string> = [
  "food",
  "lodging",
  "transport",
];

/**
 * `/trips/{tripId}/plans/{planId}`の予定の詳細（09）。種類・名前・時刻・
 * 記録に、編集・日の移動・取りやめの操作を添える。
 * 「← しおり」は表示していた日（`?from=`）に戻る。未指定なら予定の日。
 * `?from=home`ならホームに戻る（ホームの予定の行から開いたとき）。
 * 移動・取りやめの書き込みは送る直前に端末に残し（ADR-0006）、
 * 保留があればその操作の画面に送り直しの確認を出す（F-70〜F-73）。
 */
export function PlanDetailScreen({
  tripId,
  planId,
  from,
}: {
  tripId: string;
  planId: string;
  /** 遷移元。`YYYY-MM-DD`はしおりの日、`home`はホーム。未指定は予定の日。 */
  from: string | null;
}) {
  const router = useRouter();
  const { state: meState } = useMe();
  const planQuery = usePlan(tripId, planId);
  const online = useOnlineStatus();
  const [layer, setLayer] = useState<Layer | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [sheetExpired, setSheetExpired] = useState<boolean | null>(null);
  const [notAvailable, setNotAvailable] = useState<"trip" | "item" | null>(
    null,
  );

  const userId = meState.status === "ready" ? meState.me.user.id : null;
  const displayName =
    meState.status === "ready" ? meState.me.user.displayName : null;

  const moveCheck = usePendingRequestCheck({
    userId,
    tripId,
    operation: MOVE_PLAN_OPERATION,
  });
  const cancelCheck = usePendingRequestCheck({
    userId,
    tripId,
    operation: CANCEL_PLAN_OPERATION,
  });
  // 達成・予約の記録はこの画面から始まるので、その保留の照合もここで行う。
  const achieveCheck = usePendingRequestCheck({
    userId,
    tripId,
    operation: CREATE_ACHIEVEMENT_OPERATION,
  });
  const bookCheck = usePendingRequestCheck({
    userId,
    tripId,
    operation: CREATE_BOOKING_OPERATION,
  });

  const move = usePlanMutation({
    tripId,
    planId,
    send: sendMovePlan,
    userId,
    check: moveCheck.check,
    onSucceeded: () => {
      setLayer(null);
      setToast("移動しました");
    },
  });
  const cancel = usePlanMutation({
    tripId,
    planId,
    send: sendCancelPlan,
    userId,
    check: cancelCheck.check,
    onSucceeded: () => {
      setLayer(null);
      setToast("取りやめにしました");
    },
  });
  const createAchievement = useCreatePlanEvent({
    tripId,
    planId,
    send: sendCreateAchievement,
    userId,
    check: achieveCheck.check,
    onSucceeded: () => {
      setToast("達成を記録しました");
    },
  });
  const createBooking = useCreatePlanEvent({
    tripId,
    planId,
    send: sendCreateBooking,
    userId,
    check: bookCheck.check,
    onSucceeded: () => {
      setToast("予約を記録しました");
    },
  });

  // 関連する支払い（その予定に結びついたもの新しい順・最大3件）と、
  // 記録の行の名前の解決に使う参加者。
  const balance = useBalance(tripId);
  const planPayments = usePlanPayments(tripId, planId);

  // 別画面での保存成功（編集）を遷移先で1回だけ知らせる。
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

  const failure =
    planQuery.error instanceof ApiRequestError
      ? planQuery.error.failure
      : null;

  // 日の移動に期間の日が必要なので、シートを開くときだけ旅行を取る。
  const tripQuery = useTrip(tripId, { enabled: layer === "move" });
  const tripFailure =
    tripQuery.error instanceof ApiRequestError
      ? tripQuery.error.failure
      : null;

  // 期間外の拒否（旅行期間が変わった）は期間を取り直す（07 §10）。
  const refetchTrip = tripQuery.refetch;
  useEffect(() => {
    if (
      move.state.status === "rejected" &&
      move.state.code === "PLAN_OUTSIDE_TRIP_PERIOD"
    ) {
      void refetchTrip();
    }
  }, [move.state, refetchTrip]);

  // 達成・予約の409（すでに記録がある・取りやめ・種類不可）は予定を
  // 取り直して画面を「今付けられる操作」に合わせる（F-13）。
  // RECORD_ALREADY_ACTIVEはもう一度付けるよう促さず静かに追いつく
  // （E-03）。そのほかの409は理由を画面に出す。
  const refetchPlan = planQuery.refetch;
  useEffect(() => {
    for (const save of [createAchievement, createBooking]) {
      const s = save.state;
      if (s.status !== "rejected" || s.httpStatus !== 409) {
        continue;
      }
      void refetchPlan();
      if (s.code === "RECORD_ALREADY_ACTIVE") {
        save.backToEditing();
      }
    }
  }, [createAchievement, createBooking, refetchPlan]);

  // `from`はしおりの日（`YYYY-MM-DD`）か`home`。ホームから開いた
  // ときは「← ホーム」でホームに戻る（予定の行の行き先と同じ）。
  const fromHome = from === "home";
  const backDate =
    !fromHome && from !== null && isLocalDateString(from)
      ? from
      : (planQuery.data?.date ?? null);
  const backHref = fromHome
    ? `/trips/${tripId}/home`
    : `/trips/${tripId}/itinerary${backDate !== null ? `?date=${backDate}` : ""}`;
  const backLabel = fromHome ? "ホーム" : "しおり";
  const toItinerary = {
    label: fromHome ? "ホームに戻る" : "しおりに戻る",
    onClick: () => router.push(backHref),
  };

  const saves: SaveState<unknown, unknown>[] = [
    move.state,
    cancel.state,
    createAchievement.state,
    createBooking.state,
  ];
  const expired = saves.find(
    (
      state,
    ): state is Extract<
      SaveState<unknown, unknown>,
      { status: "session-expired" }
    > => state.status === "session-expired",
  );
  if (expired !== undefined || sheetExpired !== null) {
    const unconfirmed = expired?.unconfirmed === true || sheetExpired === true;
    return (
      <main>
        <SessionExpired
          unconfirmedTarget={unconfirmed ? "予定" : null}
          onGoToSignIn={() => router.push("/sign-in")}
        />
      </main>
    );
  }

  // 書き込みが403 / 404で拒否されたらC-2。新しいキーで回避しない（07 §10）。
  const writeNotAvailable = saves.find(
    (
      state,
    ): state is Extract<
      SaveState<unknown, unknown>,
      { status: "rejected" }
    > =>
      state.status === "rejected" &&
      (state.httpStatus === 403 || state.httpStatus === 404),
  );
  if (writeNotAvailable !== undefined || notAvailable !== null) {
    const target =
      notAvailable ??
      (writeNotAvailable !== undefined &&
      writeNotAvailable.httpStatus === 404
        ? "item"
        : "trip");
    return (
      <main>
        <NotAvailable
          target={target}
          onGoToTrips={() => router.push("/trips")}
          onGoToParent={toItinerary}
        />
      </main>
    );
  }

  // 日の移動のための旅行の取得も同じ拒否の出し分け。401は表示済みの
  // 予定も隠してC-1、403 / 404はC-2。
  if (
    layer === "move" &&
    tripFailure !== null &&
    tripFailure.kind === "http" &&
    tripFailure.status === 401
  ) {
    return (
      <main>
        <SessionExpired onGoToSignIn={() => router.push("/sign-in")} />
      </main>
    );
  }
  if (
    layer === "move" &&
    tripFailure !== null &&
    tripFailure.kind === "http" &&
    (tripFailure.status === 403 || tripFailure.status === 404)
  ) {
    return (
      <main>
        <NotAvailable
          target="trip"
          onGoToTrips={() => router.push("/trips")}
          onGoToParent={toItinerary}
        />
      </main>
    );
  }

  if (planQuery.isPending) {
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

  if (failure !== null && planQuery.data === undefined) {
    if (
      failure.kind === "http" &&
      (failure.status === 403 || failure.status === 404)
    ) {
      return (
        <main>
          <NotAvailable
            target={failure.status === 404 ? "item" : "trip"}
            onGoToTrips={() => router.push("/trips")}
            onGoToParent={toItinerary}
          />
        </main>
      );
    }
    return (
      <main>
        <FetchFailed onRetry={() => void planQuery.refetch()} />
      </main>
    );
  }

  const plan = planQuery.data;
  if (plan === undefined) {
    return (
      <main>
        <FetchFailed onRetry={() => void planQuery.refetch()} />
      </main>
    );
  }

  const etag = `"${plan.version}"`;
  const canCancel = plan.cancelledAt === null;

  // 「達成を記録」「予約済みを記録」は種類と取りやめで条件が分かれる
  // （F-10）。すでに記録があるときは代わりに記録行が記録の絞り込みへ
  // つながる（F-11・PlanDetailBody側）。
  const canAchieve =
    plan.cancelledAt === null &&
    plan.achievement === null &&
    ACHIEVABLE_KINDS.includes(plan.kind);
  const canBook =
    plan.booking === null && BOOKABLE_KINDS.includes(plan.kind);
  // 保存中は同じボタンを押せない（F-12）。
  const achieveBlocked =
    createAchievement.state.status === "saving" ||
    achieveCheck.check.status !== "none";
  const bookBlocked =
    createBooking.state.status === "saving" ||
    bookCheck.check.status !== "none";

  const participants = balance.data?.participants;
  const nameOfUser = (uid: string) =>
    actorNameOf(uid, participants, userId, displayName);

  const createRejected = [createAchievement.state, createBooking.state].find(
    (s): s is Extract<typeof s, { status: "rejected" }> =>
      s.status === "rejected" &&
      s.httpStatus !== 403 &&
      s.httpStatus !== 404,
  );

  const mainAction = canAchieve
    ? {
        label: "達成を記録",
        icon: (
          <CheckCircle size={20} weight="fill" aria-hidden="true" />
        ),
        onPress: () => {
          void createAchievement.submit(
            createAchievementDraft(tripId, planId),
          );
        },
        disabled: achieveBlocked || !online,
      }
    : canBook
      ? {
          label: "予約済みを記録",
          icon: (
            <CalendarCheck size={20} weight="fill" aria-hidden="true" />
          ),
          onPress: () => {
            void createBooking.submit(createBookingDraft(tripId, planId));
          },
          disabled: bookBlocked || !online,
        }
      : undefined;

  const openLayer = (next: Layer) => {
    // 前回の拒否・競合は開き直したときに持ち越さない（結果不明は残す）。
    move.backToEditing();
    cancel.backToEditing();
    setLayer(next);
  };

  const onWriteClose = (save: PlanSave) => {
    // 拒否のあとに閉じたら最新を取り直す（再送は最新のETagで）。
    if (save.state.status === "rejected") {
      void planQuery.refetch();
    }
    setLayer(null);
  };

  return (
    <main className="plan-page">
      {!online && (
        <OfflineBanner at={new Date(planQuery.dataUpdatedAt)} />
      )}
      {planQuery.isRefetchError && (
        <RefetchFailed
          fetchedAt={new Date(planQuery.dataUpdatedAt)}
          onRetry={() => void planQuery.refetch()}
        />
      )}
      {planQuery.isRefetching && <Refetching />}

      {/* 送り直しの確認（この画面で始める操作の保留が残っていれば出す） */}
      {achieveCheck.check.status === "found" && (
        <SaveUnknown
          onConfirm={() => {
            if (achieveCheck.check.status !== "found") {
              return;
            }
            void createAchievement
              .confirmRequest(achieveCheck.check.record)
              .then(achieveCheck.reload);
          }}
          confirming={createAchievement.state.status === "saving"}
        />
      )}
      {bookCheck.check.status === "found" && (
        <SaveUnknown
          onConfirm={() => {
            if (bookCheck.check.status !== "found") {
              return;
            }
            void createBooking
              .confirmRequest(bookCheck.check.record)
              .then(bookCheck.reload);
          }}
          confirming={createBooking.state.status === "saving"}
        />
      )}
      {createAchievement.state.status === "unknown" && (
        <SaveUnknown
          onConfirm={() => void createAchievement.confirmWithSameRequest()}
          confirming={false}
        />
      )}
      {createBooking.state.status === "unknown" && (
        <SaveUnknown
          onConfirm={() => void createBooking.confirmWithSameRequest()}
          confirming={false}
        />
      )}
      {(achieveCheck.check.status === "unavailable" ||
        bookCheck.check.status === "unavailable" ||
        createAchievement.state.status === "storage-unavailable" ||
        createBooking.state.status === "storage-unavailable") && (
        <StorageUnavailable />
      )}
      {createRejected !== undefined && (
        <StatusText tone="error">
          {createRejected.code === "PLAN_CANCELLED"
            ? "取りやめた予定には記録できません"
            : createRejected.code === "PLAN_KIND_NOT_SUPPORTED"
              ? "この種類の予定には記録できません"
              : "記録できませんでした"}
        </StatusText>
      )}

      <header className="plan-detail-header">
        <Link className="plan-back" href={backHref}>
          <CaretLeft size={18} weight="bold" aria-hidden="true" />
          {backLabel}
        </Link>
        <Link
          className="plan-icon-btn"
          href={`/trips/${tripId}/plans/${planId}/edit`}
          aria-label="編集"
        >
          <PencilSimple size={18} aria-hidden="true" />
        </Link>
      </header>
      <PlanDetailBody
        tripId={tripId}
        plan={plan}
        meId={userId}
        meName={displayName}
      />
      <div className="plan-detail-actions">
        {/* 予定を選んだ状態で支払いを記録のシートを開く（F-60）。 */}
        <Link
          className="btn-outline"
          href={`/trips/${tripId}/payments/new?planId=${planId}`}
        >
          <Wallet size={18} aria-hidden="true" />
          支払いを記録
        </Link>
        {/* 達成と予約の両方を付けられる予定では、予約は副ボタンにする
            （主ボタンは下のタブの上に達成を記録として出る）。 */}
        {canAchieve && canBook && (
          <button
            type="button"
            className="btn-outline"
            disabled={bookBlocked || !online}
            onClick={() => {
              void createBooking.submit(createBookingDraft(tripId, planId));
            }}
          >
            <CalendarCheck size={18} aria-hidden="true" />
            予約済みを記録
          </button>
        )}
        {/* 予約はこのアプリの中の記録であることを添える（F-08） */}
        {canBook && (
          <p className="record-note">
            このアプリの中の記録です。お店の予約は変わりません
          </p>
        )}
        <button
          type="button"
          className="btn-outline"
          onClick={() => openLayer("move")}
        >
          <CalendarBlank size={18} aria-hidden="true" />
          日の移動
        </button>
        {canCancel && (
          <button
            type="button"
            className="btn-outline"
            onClick={() => openLayer("cancel")}
          >
            <Prohibit size={18} aria-hidden="true" />
            取りやめにする
          </button>
        )}
      </div>
      {/* その予定に結びついた支払いを新しい順に最大3件（F-14） */}
      <section className="plan-payments" aria-label="関連する支払い">
        <h2 className="plan-payments-title">関連する支払い</h2>
        {planPayments.isPending ? (
          <Loading />
        ) : planPayments.data === undefined ? (
          <FetchFailed
            message="支払いを取得できませんでした"
            onRetry={() => void planPayments.refetch()}
          />
        ) : planPayments.data.length === 0 ? (
          <p className="record-empty-text">まだありません</p>
        ) : (
          <div className="record-card">
            {planPayments.data.map((item) => (
              <RecordRowView
                key={item.id}
                tripId={tripId}
                item={item}
                actorName={nameOfUser(item.actorId)}
                nameOfUser={nameOfUser}
                onOpenEvent={() => {}}
              />
            ))}
          </div>
        )}
        {/* 支払いが1件も無ければ、記録の一覧で見るものが無いので出さない */}
        {planPayments.data !== undefined && planPayments.data.length > 0 && (
          <Link
            className="btn-outline plan-payments-more"
            href={`/trips/${tripId}/records?planId=${planId}`}
          >
            記録で見る
          </Link>
        )}
      </section>
      {layer === "move" &&
        (tripQuery.data !== undefined ? (
          <PlanMoveSheet
            trip={tripQuery.data}
            plan={plan}
            etag={etag}
            move={move}
            movePending={moveCheck}
            onClose={() => onWriteClose(move)}
            onSessionExpired={(unconfirmed) => {
              setLayer(null);
              setSheetExpired(unconfirmed);
            }}
            onNotAvailable={(target) => {
              setLayer(null);
              setNotAvailable(target);
            }}
          />
        ) : tripFailure !== null ? (
          <Sheet title="日の移動" onClose={() => onWriteClose(move)}>
            <StatusText tone="error">
              旅行の期間を取得できませんでした
            </StatusText>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => void tripQuery.refetch()}
            >
              再試行
            </button>
          </Sheet>
        ) : (
          <Loading />
        ))}
      {layer === "cancel" && (
        <CancelPlanDialog
          plan={plan}
          etag={etag}
          cancel={cancel}
          cancelPending={cancelCheck}
          onClose={() => onWriteClose(cancel)}
          onSessionExpired={(unconfirmed) => {
            setLayer(null);
            setSheetExpired(unconfirmed);
          }}
          onNotAvailable={(target) => {
            setLayer(null);
            setNotAvailable(target);
          }}
        />
      )}
      {toast !== null && (
        <Toast message={toast} onDismiss={() => setToast(null)} />
      )}
      <TripTabBar tripId={tripId} current="itinerary" action={mainAction} />
    </main>
  );
}
