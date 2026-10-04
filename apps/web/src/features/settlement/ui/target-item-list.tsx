import type {
  Participant,
  TargetItem,
} from "../api/settlement-api";
import { formatYen, yenFromDecimalString } from "@/shared/lib/yen";
import {
  itemBurdenLabel,
  itemShareLabel,
  nameOf,
  paymentNameOf,
  splitLabelOf,
} from "../model/breakdown";

/**
 * 対象の明細。`breakdown`は精算の画面（v3の14b）の形
 * （名前・金額・「誰が払ったか・分け方」・二人の負担）。
 * `confirm`は受け渡しの確認（v3の14c・14h）の形
 * （名前・金額の下に「負担 … 円」の1行。受け渡しの無い確認は
 * 行末に「{name} が支払い」を添える）。
 * 戻し（REVERSAL）は金額を負で、説明を「取り消し済みの戻し」で出す。
 */
export function TargetItemList({
  items,
  participants,
  title = "対象の明細",
  variant = "breakdown",
  showPayer = false,
}: {
  items: TargetItem[];
  participants: Participant[];
  title?: string;
  variant?: "breakdown" | "confirm";
  /** variant="confirm"で受け渡しが無い確認（0円）のときtrue（v3の14h）。 */
  showPayer?: boolean;
}) {
  return (
    <section className="settle-card">
      <h2 className="settle-card-title">{title}</h2>
      <ul className="settle-items">
        {items.map((item) => {
          const payment = item.payment;
          const reversal = item.kind === "REVERSAL";
          const amount = yenFromDecimalString(payment.amountYen) ?? 0n;
          const signedAmount = reversal ? -amount : amount;
          const payerName = nameOf(participants, payment.payerUserId);
          const shareText =
            variant === "confirm"
              ? `${itemBurdenLabel(item, participants)}${reversal ? " · 取り消し済みの戻し" : ""}${showPayer ? ` · ${payerName} が支払い` : ""}`
              : itemShareLabel(item, participants);
          return (
            <li
              className={
                variant === "confirm"
                  ? "settle-item settle-item-confirm"
                  : "settle-item"
              }
              key={`${payment.id}-${item.kind}`}
            >
              <div className="settle-item-head">
                <span className="settle-item-name">
                  {paymentNameOf(payment)}
                </span>
                <span className="settle-item-amount tabular-nums">
                  {formatYen(signedAmount)}
                </span>
              </div>
              {variant === "breakdown" && (
                <span className="settle-item-meta">
                  {reversal
                    ? `${payerName} が支払い · 取り消し済みの戻し`
                    : `${payerName} が支払い · ${splitLabelOf(payment, participants)}`}
                </span>
              )}
              <span className="settle-item-share tabular-nums">
                {shareText}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
