import type {
  Participant,
  TargetItem,
} from "../api/settlement-api";
import { formatYen, yenFromDecimalString } from "@/shared/lib/yen";
import {
  itemShareLabel,
  nameOf,
  paymentNameOf,
  splitLabelOf,
} from "../model/breakdown";

/**
 * 対象の明細（v3の14bの明細欄・14cの「対象の明細」）。
 * 支払いごとに名前・金額・「誰が払ったか・分け方」・二人の負担を出す。
 * 戻し（REVERSAL）は金額を負で、説明を「取り消し済みの戻し」で出す。
 */
export function TargetItemList({
  items,
  participants,
  title = "対象の明細",
}: {
  items: TargetItem[];
  participants: Participant[];
  title?: string;
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
          return (
            <li className="settle-item" key={`${payment.id}-${item.kind}`}>
              <div className="settle-item-head">
                <span className="settle-item-name">
                  {paymentNameOf(payment)}
                </span>
                <span className="settle-item-amount tabular-nums">
                  {formatYen(signedAmount)}
                </span>
              </div>
              <span className="settle-item-meta">
                {reversal
                  ? `${nameOf(participants, payment.payerUserId)} が支払い · 取り消し済みの戻し`
                  : `${nameOf(participants, payment.payerUserId)} が支払い · ${splitLabelOf(payment, participants)}`}
              </span>
              <span className="settle-item-share tabular-nums">
                {itemShareLabel(item, participants)}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
