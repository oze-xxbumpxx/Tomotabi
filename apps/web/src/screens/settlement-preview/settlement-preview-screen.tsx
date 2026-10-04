"use client";

import {
  ArrowRight,
  CaretLeft,
  Check,
  LockSimple,
} from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useMe } from "@/features/auth";
import {
  CompleteSettlementDialog,
  settlementPreviewQueryKey,
  TargetItemList,
  transferDirectionOf,
  useCompleteSettlement,
  useSettlementPreview,
} from "@/features/settlement";
import type {
  Preview,
  PreviewValidationStatus,
} from "@/features/settlement";
import { ApiRequestError } from "@/shared/api/api-failure";
import { usePendingRequestCheck } from "@/shared/browser/use-pending-request-check";
import { formatDateTime } from "@/shared/lib/local-date";
import { setPendingToast } from "@/shared/lib/pending-toast";
import { formatYen } from "@/shared/lib/yen";
import { FetchFailed } from "@/shared/ui/state/fetch-failed";
import { Loading } from "@/shared/ui/state/loading";
import { NotAvailable } from "@/shared/ui/state/not-available";
import { OfflineBanner } from "@/shared/ui/state/offline-banner";
import { SaveUnknown } from "@/shared/ui/state/save-unknown";
import { SessionExpired } from "@/shared/ui/state/session-expired";
import { StorageUnavailable } from "@/shared/ui/state/storage-unavailable";
import { useOnlineStatus } from "@/shared/ui/state/use-online-status";

function failureOf(error: unknown) {
  return error instanceof ApiRequestError ? error.failure : null;
}

/**
 * 作成した時点の対象と金額で固定した向き・金額のカード（14c・14h）。
 * 1行目に「{name} から → {name} へ」（非0円）または「受け渡しは不要です」
 * （0円）、その下に大きな金額、最後に固定の注記を左寄せで並べる。
 */
function FixedTransferCard({ preview }: { preview: Preview }) {
  const direction = transferDirectionOf(
    preview.transfer,
    preview.participants,
  );
  return (
    <section className="settle-card">
      {direction === null ? (
        <p className="settle-direction">受け渡しは不要です</p>
      ) : (
        <p className="settle-direction">
          <strong>{direction.fromName}</strong> から{" "}
          <ArrowRight size={14} weight="bold" aria-hidden="true" />{" "}
          <strong>{direction.toName}</strong> へ
        </p>
      )}
      <p className="settle-amount settle-amount-fixed tabular-nums">
        {direction === null ? "0 円" : formatYen(direction.amount)}
      </p>
      <p className="settle-fixed-note">
        <LockSimple size={12} weight="bold" aria-hidden="true" />
        作成した時点の対象と金額で固定しています
      </p>
    </section>
  );
}

const CANNOT_RECORD_STATUSES: readonly PreviewValidationStatus[] = [
  "cancelled_items_ack_required",
  "target_changed",
];

/**
 * `/trips/{tripId}/settlement/previews/{previewId}`の受け渡しの確認
 * （v3の14c・14d・14h）。非0円は「表示の全額を受け渡しました」に
 * チェックするまで完了を押せない。0円はチェックなし。
 * 検証結果が`cancelled_items_ack_required`・`target_changed`のときは
 * 「この確認では記録できません」と精算の画面への導線だけ。
 * `already_completed`・`completed_then_cancelled`は既存の精算への導線。
 */
export function SettlementPreviewScreen({
  tripId,
  previewId,
}: {
  tripId: string;
  previewId: string;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { state: meState } = useMe();
  const online = useOnlineStatus();
  const preview = useSettlementPreview(tripId, previewId);
  const [checked, setChecked] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [sheetExpired, setSheetExpired] = useState<boolean | null>(null);

  const userId = meState.status === "ready" ? meState.me.user.id : null;

  const { check, reload } = usePendingRequestCheck({
    userId,
    tripId,
    operation: "completeSettlement",
  });
  const complete = useCompleteSettlement({
    userId,
    tripId,
    previewId,
    check,
    onSucceeded: () => {
      setPendingToast("今回の精算を記録しました");
      router.push(`/trips/${tripId}/settlement`);
    },
  });

  useEffect(() => {
    if (meState.status === "unauthenticated") {
      router.replace("/sign-in");
    }
  }, [meState.status, router]);

  // 確定した拒否のあとは確認を取り直す（検証結果が変わっていることがある）。
  useEffect(() => {
    if (complete.state.status === "rejected") {
      void queryClient.invalidateQueries({
        queryKey: settlementPreviewQueryKey(tripId, previewId),
      });
    }
  }, [complete.state.status, queryClient, tripId, previewId]);

  const expired =
    complete.state.status === "session-expired" || sheetExpired !== null;
  if (expired) {
    const unconfirmed =
      (complete.state.status === "session-expired" &&
        complete.state.unconfirmed) ||
      sheetExpired === true;
    return (
      <main>
        <SessionExpired
          unconfirmedTarget={unconfirmed ? "受け渡しの確認" : null}
          onGoToSignIn={() => router.push("/sign-in")}
        />
      </main>
    );
  }

  const failure = failureOf(preview.error);
  if (failure !== null) {
    if (failure.kind === "http") {
      if (failure.status === 401) {
        return (
          <main>
            <SessionExpired onGoToSignIn={() => router.push("/sign-in")} />
          </main>
        );
      }
      if (failure.status === 403 || failure.status === 404) {
        return (
          <main>
            <NotAvailable
              target="item"
              onGoToTrips={() => router.push("/trips")}
              onGoToParent={{
                label: "精算へ",
                onClick: () => router.push(`/trips/${tripId}/settlement`),
              }}
            />
          </main>
        );
      }
    }
    if (preview.data === undefined) {
      return (
        <main>
          <FetchFailed onRetry={() => void preview.refetch()} />
        </main>
      );
    }
  }

  if (preview.data === undefined) {
    return (
      <main>
        <Loading />
      </main>
    );
  }

  const data = preview.data;
  const direction = transferDirectionOf(data.transfer, data.participants);
  const status = data.validation.status;
  const ready = status === "ready";
  const cannotRecord = CANNOT_RECORD_STATUSES.includes(status);

  const settlementUrl = `/trips/${tripId}/settlement`;

  /** 完了の主操作。保留がある・確認中・確認できないあいだは新しい要求を送らない。 */
  const recordAction = () => {
    if (check.status === "found") {
      return (
        <SaveUnknown
          confirming={complete.state.status === "saving"}
          onConfirm={() =>
            void complete.confirmRequest(check.record).then(reload)
          }
        />
      );
    }
    if (
      check.status === "unavailable" ||
      complete.state.status === "storage-unavailable"
    ) {
      return <StorageUnavailable />;
    }
    const disabled =
      check.status === "checking" ||
      complete.state.status === "saving" ||
      complete.state.status === "succeeded" ||
      !online ||
      (direction !== null && !checked);
    return (
      <button
        type="button"
        className="btn-ink settle-action"
        disabled={disabled}
        onClick={() => setDialogOpen(true)}
      >
        <Check size={18} weight="bold" aria-hidden="true" />
        {direction === null
          ? "受け渡し不要として精算を記録"
          : "受け渡し完了を記録"}
      </button>
    );
  };

  return (
    <main className="settle-page">
      {!online && <OfflineBanner at={new Date(data.createdAt)} />}
      <header className="settle-preview-head">
        <Link className="plan-back" href={settlementUrl}>
          <CaretLeft size={16} weight="bold" aria-hidden="true" />
          精算
        </Link>
      </header>
      <h1 className="page-title">受け渡しの確認</h1>
      <p className="settle-preview-meta tabular-nums">
        {`${formatDateTime(data.createdAt)} に作成 · 対象 ${data.items.length} 件`}
      </p>

      <FixedTransferCard preview={data} />
      <TargetItemList
        items={data.items}
        participants={data.participants}
        variant="confirm"
        showPayer={direction === null}
      />

      {ready ? (
        <>
          {direction !== null && check.status !== "found" && (
            <label className="settle-check">
              <input
                type="checkbox"
                checked={checked}
                disabled={
                  check.status !== "none" ||
                  complete.state.status !== "editing"
                }
                onChange={(event) => setChecked(event.currentTarget.checked)}
              />
              表示の全額を受け渡しました
            </label>
          )}
          {recordAction()}
          {dialogOpen && (
            <CompleteSettlementDialog
              tripId={tripId}
              preview={data}
              participants={data.participants}
              complete={complete}
              onClose={() => {
                setDialogOpen(false);
                complete.backToEditing();
              }}
              onSessionExpired={(unconfirmed) => {
                setDialogOpen(false);
                setSheetExpired(unconfirmed);
              }}
            />
          )}
        </>
      ) : cannotRecord ? (
        <div className="settle-cannot">
          <p className="settle-cannot-text">
            この確認では記録できません。精算の画面に戻って確認し直してください。
          </p>
          <Link className="btn-ink settle-action" href={settlementUrl}>
            精算の画面へ
          </Link>
        </div>
      ) : (
        <div className="settle-cannot">
          <p className="settle-cannot-text">
            {status === "already_completed"
              ? "この確認はすでに精算として記録されています。"
              : "この確認の精算は取り消されています。"}
          </p>
          <Link className="btn-ink settle-action" href={settlementUrl}>
            精算の画面へ
          </Link>
        </div>
      )}
    </main>
  );
}
