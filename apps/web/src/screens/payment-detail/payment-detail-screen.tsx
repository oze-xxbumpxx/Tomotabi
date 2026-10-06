"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowUUpLeft, CaretLeft, CaretRight } from "@phosphor-icons/react";
import {
  actorNameOf,
  CancelRecordDialog,
  shareNoteOfPayment,
} from "@/features/records";
import {
  CANCEL_PAYMENT_OPERATION,
  cancelPaymentDraft,
  useBalance,
  useCancelPayment,
  usePayment,
} from "@/features/payments";
import { usePlan } from "@/features/plans";
import { TripTabBar } from "@/features/trips";
import { useMe } from "@/features/auth";
import { ApiRequestError } from "@/shared/api/api-failure";
import { usePendingRequestCheck } from "@/shared/browser/use-pending-request-check";
import { formatDateTime } from "@/shared/lib/local-date";
import { formatYen, yenFromDecimalString } from "@/shared/lib/yen";
import { useOnlineStatus } from "@/shared/ui/state/use-online-status";
import { FetchFailed } from "@/shared/ui/state/fetch-failed";
import { Loading } from "@/shared/ui/state/loading";
import { NotAvailable } from "@/shared/ui/state/not-available";
import { OfflineBanner } from "@/shared/ui/state/offline-banner";
import { SaveUnknown } from "@/shared/ui/state/save-unknown";
import { SessionExpired } from "@/shared/ui/state/session-expired";
import { StorageUnavailable } from "@/shared/ui/state/storage-unavailable";
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
 * 支払いの詳細（/trips/{tripId}/payments/{paymentId}）。
 * 金額・払った人・二人の負担・用途・関連する予定・誰がいつ記録したかを
 * 読み取り専用で出し、まだ有効な支払いには「取り消す」を出す。
 * 取り消したあとは「取り消し済み」と、同じ内容を写した記録へ進む
 * 「正しい内容で支払いを記録」を出す（訂正は取り消しと別の保存）。
 */
export function PaymentDetailScreen({
  tripId,
  paymentId,
}: {
  tripId: string;
  paymentId: string;
}) {
  const router = useRouter();
  const { state: meState } = useMe();
  const online = useOnlineStatus();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const userId = meState.status === "ready" ? meState.me.user.id : null;
  const meName =
    meState.status === "ready" ? meState.me.user.displayName : null;

  const payment = usePayment(tripId, paymentId);
  const balance = useBalance(tripId);
  const participants = balance.data?.participants;
  const planId = payment.data?.planId ?? null;
  const plan = usePlan(tripId, planId ?? "", { enabled: planId !== null });

  const nameOfUser = (actorId: string) =>
    actorNameOf(actorId, participants, userId, meName);

  // 支払いの取り消しはこの画面から始まるので、保留の照合もここで行う。
  const cancelPending = usePendingRequestCheck({
    userId,
    tripId,
    operation: CANCEL_PAYMENT_OPERATION,
  });
  const cancel = useCancelPayment({
    tripId,
    userId,
    check: cancelPending.check,
    onSucceeded: () => {
      setDialogOpen(false);
      setToast("取り消しました");
    },
  });

  // ---- C-1 / C-2 ----
  if (meState.status === "unauthenticated") {
    return (
      <main>
        <SessionExpired onGoToSignIn={() => router.push("/sign-in")} />
      </main>
    );
  }

  if (
    cancel.state.status === "session-expired" ||
    isAuthFailure(payment.error) ||
    isAuthFailure(balance.error)
  ) {
    return (
      <main>
        <SessionExpired
          unconfirmedTarget={
            cancel.state.status === "session-expired" &&
            cancel.state.unconfirmed
              ? "記録"
              : null
          }
          onGoToSignIn={() => router.push("/sign-in")}
        />
      </main>
    );
  }

  const writeNotAvailable =
    cancel.state.status === "rejected" &&
    (cancel.state.httpStatus === 403 || cancel.state.httpStatus === 404);
  if (
    writeNotAvailable ||
    isNotAvailableFailure(balance.error) ||
    // 支払い自体が開けないときは「この項目を開けません」＋記録への導線
    isNotAvailableFailure(payment.error)
  ) {
    const itemGone = isNotAvailableFailure(payment.error);
    return (
      <main>
        <NotAvailable
          target={itemGone ? "item" : "trip"}
          onGoToTrips={() => router.push("/trips")}
          onGoToParent={
            itemGone
              ? {
                  label: "記録に戻る",
                  onClick: () => router.push(`/trips/${tripId}/records`),
                }
              : null
          }
        />
      </main>
    );
  }

  const cancellation = payment.data?.cancellation ?? null;
  const paymentData = payment.data;
  const amountYen =
    paymentData === undefined
      ? null
      : yenFromDecimalString(paymentData.amountYen);
  const amountText =
    amountYen === null ? "" : formatYen(amountYen);
  const paymentSubject =
    paymentData === undefined
      ? "支払い"
      : `支払い「${
          paymentData.label !== null
            ? `${paymentData.label} ${amountText}`
            : amountText
        }」`;

  return (
    <main className="payment-detail">
      {!online && <OfflineBanner at={null} />}
      <header className="plan-detail-header">
        <Link className="plan-back" href={`/trips/${tripId}/records`}>
          <CaretLeft size={18} weight="bold" aria-hidden="true" />
          記録
        </Link>
      </header>
      <p className="payment-detail-kind">支払い</p>

      {cancelPending.check.status === "found" && (
        <SaveUnknown
          onConfirm={() => {
            if (cancelPending.check.status !== "found") {
              return;
            }
            void cancel
              .confirmRequest(cancelPending.check.record)
              .then(cancelPending.reload);
          }}
          confirming={cancel.state.status === "saving"}
        />
      )}
      {cancelPending.check.status === "unavailable" && (
        <StorageUnavailable />
      )}

      {payment.isPending || balance.isPending ? (
        <Loading />
      ) : paymentData === undefined ? (
        <section className="payment-detail-card">
          <FetchFailed
            message="支払いを取得できませんでした"
            onRetry={() => void payment.refetch()}
          />
        </section>
      ) : balance.data === undefined ? (
        <section className="payment-detail-card">
          <FetchFailed
            message="参加者を取得できませんでした"
            onRetry={() => void balance.refetch()}
          />
        </section>
      ) : (
        <>
          {/* 読むだけの画面なので、入力の部品ではなく「項目名と値」で並べる
              （v3の予定の詳細と同じ形） */}
          <div className="payment-detail-head">
            <h1
              className={
                cancellation !== null
                  ? "payment-detail-name payment-detail-name-voided"
                  : "payment-detail-name"
              }
            >
              {paymentData.label ?? "支払い"}
            </h1>
            <p
              className={
                cancellation !== null
                  ? "payment-detail-amount tabular-nums payment-detail-name-voided"
                  : "payment-detail-amount tabular-nums"
              }
            >
              {amountText}
            </p>
          </div>
          <dl className="payment-detail-rows">
            <div className="payment-detail-row">
              <dt>払った人</dt>
              <dd>{nameOfUser(paymentData.payerUserId) || "相手"}</dd>
            </div>
            <div className="payment-detail-row">
              <dt>負担の分け方</dt>
              <dd>
                {shareNoteOfPayment(paymentData, nameOfUser) === "割合"
                  ? `割合を指定（${paymentData.allocations
                      .map((a) => `${nameOfUser(a.userId) || "相手"} ${a.percent}%`)
                      .join(" · ")}）`
                  : shareNoteOfPayment(paymentData, nameOfUser)}
              </dd>
            </div>
            <div className="payment-detail-row">
              <dt>負担額</dt>
              <dd className="tabular-nums">
                {paymentData.allocations
                  .map(
                    (a) =>
                      `${nameOfUser(a.userId) || "相手"} ${formatYen(
                        yenFromDecimalString(a.burdenYen) ?? 0n,
                      )}`,
                  )
                  .join(" · ")}
              </dd>
            </div>
            <div className="payment-detail-row">
              <dt>関連する予定</dt>
              <dd>
                {planId === null ? (
                  "なし"
                ) : plan.isError ? (
                  <button
                    type="button"
                    className="payment-detail-retry"
                    onClick={() => void plan.refetch()}
                  >
                    予定を取得できませんでした。再取得する
                  </button>
                ) : (
                  <Link
                    className="payment-detail-plan"
                    href={`/trips/${tripId}/plans/${planId}`}
                  >
                    {plan.data?.name ?? "予定"}
                    <CaretRight size={14} weight="bold" aria-hidden="true" />
                  </Link>
                )}
              </dd>
            </div>
            <div className="payment-detail-row">
              <dt>記録</dt>
              <dd>
                {nameOfUser(paymentData.createdBy) !== ""
                  ? `${nameOfUser(paymentData.createdBy)} が `
                  : ""}
                {formatDateTime(paymentData.createdAt)}
              </dd>
            </div>
          </dl>

          {cancellation !== null ? (
            <>
              <p className="payment-detail-voided">
                <span className="rrow-pill">取り消し済み</span>
                {nameOfUser(cancellation.cancelledBy) !== ""
                  ? `${nameOfUser(cancellation.cancelledBy)} が `
                  : ""}
                {formatDateTime(cancellation.createdAt)} に取り消し
              </p>
              <div className="payment-detail-actions">
                <Link
                  className="btn-ink"
                  href={`/trips/${tripId}/payments/new?from=${paymentId}`}
                >
                  正しい内容で支払いを記録
                </Link>
                <p className="record-side-note">
                  取り消しと新しい記録は別々に保存されます
                </p>
              </div>
            </>
          ) : (
            <div className="payment-detail-actions">
              <button
                type="button"
                className="btn-danger"
                disabled={
                  !online || cancelPending.check.status !== "none"
                }
                onClick={() => setDialogOpen(true)}
              >
                <ArrowUUpLeft
                  size={16}
                  weight="bold"
                  aria-hidden="true"
                />
                取り消す
              </button>
            </div>
          )}
        </>
      )}

      {dialogOpen && paymentData !== undefined && (
        <CancelRecordDialog
          subject={paymentSubject}
          payment
          draft={cancelPaymentDraft(tripId, paymentId)}
          save={cancel}
          pending={cancelPending}
          onClose={() => setDialogOpen(false)}
          onSessionExpired={() => {}}
          onNotAvailable={() => {}}
        />
      )}

      {toast !== null && (
        <Toast message={toast} onDismiss={() => setToast(null)} />
      )}
      {/* 「支払いを記録」は画面の中の「正しい内容で支払いを記録」と
          意味が重なり、下に固定すると中身に重なるので出さない */}
      <TripTabBar tripId={tripId} current="records" action={null} />
    </main>
  );
}
