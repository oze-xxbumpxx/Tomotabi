import Link from "next/link";
import { useState } from "react";
import type { ReactNode } from "react";
import { ArrowUUpLeft } from "@phosphor-icons/react";
import type { MutationDraft } from "@/shared/api/mutation-request";
import type { PendingRequestCheck } from "@/shared/browser/use-pending-request-check";
import { formatDateTime } from "@/shared/lib/local-date";
import { Loading } from "@/shared/ui/state/loading";
import { Sheet } from "@/shared/ui/sheet";
import type { Event } from "../api/records-api";
import { baseKindLabelOf } from "../model/record-view";
import {
  CancelRecordDialog,
  type RecordCancelHandle,
} from "./cancel-record-dialog";

/**
 * 達成・予約の記録を押したときに下から出す小さな詳細。
 * 種類・予定の名前・誰がいつ記録したか・「予定を開く」・「取り消す」を
 * 出す。予約の記録には「このアプリの中の記録です。お店の予約は
 * 変わりません」（F-08）を添える。元の記録が取り消し済みなら
 * 取り消した人と日時を出し、「取り消す」は出さない。
 */
export function PlanEventSheet({
  tripId,
  /** 元の記録。取り消しの行から開いたときは取り出し中にnull。 */
  event,
  actorNameOf,
  planName,
  cancel,
  onClose,
  onSessionExpired,
  onNotAvailable,
}: {
  tripId: string;
  event: Event | null;
  /** userId → 表示名の解決。 */
  actorNameOf: (actorId: string) => string;
  /** 予定のIDから名前の表示を返す。 */
  planName: (planId: string) => ReactNode;
  cancel: {
    save: RecordCancelHandle;
    pending: { check: PendingRequestCheck; reload: () => void };
    /** 対象の記録の取り消し要求。 */
    draft: (recordId: string) => MutationDraft;
  };
  onClose: () => void;
  onSessionExpired: (unconfirmed: boolean) => void;
  onNotAvailable: (target: "trip" | "item") => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const kindLabel =
    event === null
      ? "記録"
      : baseKindLabelOf(event.kind as "achievement" | "booking");

  return (
    <Sheet
      title="記録"
      onClose={onClose}
      footer={
        event !== null ? (
          <>
            <Link
              className="btn-secondary"
              href={`/trips/${tripId}/plans/${event.planId}`}
            >
              予定を開く
            </Link>
            {event.cancellation === null && (
              <button
                type="button"
                className="btn-danger"
                onClick={() => setConfirming(true)}
              >
                <ArrowUUpLeft
                  size={16}
                  weight="bold"
                  aria-hidden="true"
                />
                取り消す
              </button>
            )}
          </>
        ) : undefined
      }
    >
      {event === null ? (
        <Loading />
      ) : (
        <div className="record-detail">
          <dl className="record-detail-rows">
            <div className="record-detail-row">
              <dt className="record-detail-label">種類</dt>
              <dd className="record-detail-value">{kindLabel}</dd>
            </div>
            <div className="record-detail-row">
              <dt className="record-detail-label">予定</dt>
              <dd className="record-detail-value">
                {planName(event.planId)}
              </dd>
            </div>
            <div className="record-detail-row">
              <dt className="record-detail-label">記録</dt>
              <dd className="record-detail-value">
                {actorNameOf(event.createdBy) !== ""
                  ? `${actorNameOf(event.createdBy)} が `
                  : ""}
                {formatDateTime(event.createdAt)} に記録
              </dd>
            </div>
            {event.cancellation !== null && (
              <div className="record-detail-row">
                <dt className="record-detail-label">取り消し</dt>
                <dd className="record-detail-value">
                  {actorNameOf(event.cancellation.cancelledBy) !== ""
                    ? `${actorNameOf(event.cancellation.cancelledBy)} が `
                    : ""}
                  {formatDateTime(event.cancellation.createdAt)} に取り消し
                </dd>
              </div>
            )}
          </dl>
          {event.kind === "booking" && (
            <p className="record-note">
              このアプリの中の記録です。お店の予約は変わりません
            </p>
          )}
        </div>
      )}
      {confirming && event !== null && (
        <CancelRecordDialog
          subject={
            <>
              「{planName(event.planId)}」の{kindLabel}
            </>
          }
          payment={false}
          draft={cancel.draft(event.id)}
          save={cancel.save}
          pending={cancel.pending}
          onClose={() => {
            setConfirming(false);
          }}
          onSessionExpired={onSessionExpired}
          onNotAvailable={onNotAvailable}
        />
      )}
    </Sheet>
  );
}
