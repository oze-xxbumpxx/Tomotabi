"use client";

import { Check } from "@phosphor-icons/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { PendingRequestCheck } from "@/shared/browser/use-pending-request-check";
import { formatDateTime } from "@/shared/lib/local-date";
import { formatYen, yenFromDecimalString } from "@/shared/lib/yen";
import { SaveUnknown } from "@/shared/ui/state/save-unknown";
import { StorageUnavailable } from "@/shared/ui/state/storage-unavailable";
import { useOnlineStatus } from "@/shared/ui/state/use-online-status";
import type { Preview } from "../api/settlement-api";
import { nameOf, paymentNameOf, transferDirectionOf } from "../model/breakdown";
import type { SettlementSave } from "../model/settlement-save";
import { CompleteSettlementDialog } from "./complete-settlement-dialog";

/**
 * 取り消された対象の了承（F-61・F-62・F-63、v3の14f相当）。
 * 確認を作ったあとに対象の支払いが取り消されたとき、取り消された明細
 * （名前・金額・誰がいつ取り消したか）と二つの道を出す。
 * まだ受け渡していなければ「最新の残額で確認を作り直す」。
 * 元の金額をもう全額受け渡したなら、明細ごとのチェックを全部付けると
 * 「了承して受け渡し完了を記録」を押せる。記録の要求には現在の
 * `cancelledPaymentIds`の全部を`acknowledgedCancellationPaymentIds`に入れる。
 * 0円の確認（受け渡しの無い確認）では了承の道は出さない。
 * 呼び出し側は`cancelledPaymentIds`でkeyを付け替えて、取り直したあとに
 * 取り消しの一覧が変わったらチェックを外して確かめ直させる。
 */
export function CancelledItemsAck({
  tripId,
  preview,
  complete,
  check,
  reload,
  onSessionExpired,
}: {
  tripId: string;
  preview: Preview;
  complete: SettlementSave;
  check: PendingRequestCheck;
  reload: () => void;
  onSessionExpired: (unconfirmed: boolean) => void;
}) {
  const online = useOnlineStatus();
  const [ackChecked, setAckChecked] = useState<ReadonlySet<string>>(new Set());
  const [dialogOpen, setDialogOpen] = useState(false);

  // 取り直したあと取り消しの一覧が変わるとこの部品は再マウントされる
  // （呼び出し側のkey）。拒否のダイアログごと失われるので、拒否の状態が
  // 残っていたら編集に戻して、新しい一覧を確かめ直させる。
  // 再マウントのときだけ働かせる。あとからrejectedになるのは
  // 開いているダイアログが扱う。
  useEffect(() => {
    if (complete.state.status === "rejected") {
      complete.backToEditing();
    }
  }, []);

  const direction = transferDirectionOf(preview.transfer, preview.participants);
  const cancelledIds = preview.validation.cancelledPaymentIds;
  const cancelledItems = preview.items.filter(
    (item) =>
      item.kind === "BASE" && cancelledIds.includes(item.payment.id),
  );
  const settlementUrl = `/trips/${tripId}/settlement`;

  const toggle = (paymentId: string, checked: boolean) => {
    setAckChecked((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(paymentId);
      } else {
        next.delete(paymentId);
      }
      return next;
    });
  };

  const allChecked = cancelledItems.every((item) =>
    ackChecked.has(item.payment.id),
  );

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
      !allChecked;
    return (
      <button
        type="button"
        className="btn-ink settle-action"
        disabled={disabled}
        onClick={() => setDialogOpen(true)}
      >
        <Check size={18} weight="bold" aria-hidden="true" />
        了承して受け渡し完了を記録
      </button>
    );
  };

  return (
    <section className="settle-card">
      <h2 className="settle-card-title">
        対象の支払いが取り消されました
      </h2>
      <p className="settle-cannot-text">
        確認を作ったあとに次の支払いが取り消されました。この確認の金額は変わりません。
      </p>
      <ul className="settle-items">
        {cancelledItems.map((item) => {
          const payment = item.payment;
          const amount = yenFromDecimalString(payment.amountYen) ?? 0n;
          const cancellation = payment.cancellation;
          return (
            <li
              className="settle-item settle-item-confirm"
              key={payment.id}
            >
              <div className="settle-item-head">
                <span className="settle-item-name">
                  {paymentNameOf(payment)}
                </span>
                <span className="settle-item-amount tabular-nums">
                  {formatYen(amount)}
                </span>
              </div>
              <span className="settle-item-meta">
                {cancellation !== null
                  ? `${nameOf(preview.participants, cancellation.cancelledBy)} が ${formatDateTime(cancellation.createdAt)} に取り消しました`
                  : "取り消されました"}
              </span>
            </li>
          );
        })}
      </ul>

      <div className="settle-cannot">
        <p className="settle-cannot-text">
          まだ受け渡していなければ、最新の残額で確認を作り直してください。
        </p>
        <Link className="btn-secondary settle-action" href={settlementUrl}>
          最新の残額で確認を作り直す
        </Link>
      </div>

      {direction !== null && (
        <div className="settle-cannot">
          <p className="settle-cannot-text">
            元の金額をもう全額受け渡した場合は、取り消された支払いを1件ずつ確かめて、了承してこの確認で記録できます。
          </p>
          {cancelledItems.map((item) => (
            <label className="settle-check" key={item.payment.id}>
              <input
                type="checkbox"
                checked={ackChecked.has(item.payment.id)}
                disabled={
                  check.status !== "none" ||
                  complete.state.status !== "editing"
                }
                onChange={(event) =>
                  toggle(item.payment.id, event.currentTarget.checked)
                }
              />
              {paymentNameOf(item.payment)}の取り消しを確かめました
            </label>
          ))}
          {recordAction()}
          {dialogOpen && (
            <CompleteSettlementDialog
              tripId={tripId}
              preview={preview}
              participants={preview.participants}
              complete={complete}
              acknowledgedIds={cancelledIds}
              onClose={() => {
                setDialogOpen(false);
                complete.backToEditing();
              }}
              onSessionExpired={onSessionExpired}
            />
          )}
        </div>
      )}
    </section>
  );
}
