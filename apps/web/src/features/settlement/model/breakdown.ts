import type {
  Participant,
  Payment,
  SettlementCreateCompletionKind,
  TargetItem,
  Transfer,
} from "../api/settlement-api";
import { formatYen, yenFromDecimalString } from "@/shared/lib/yen";

/**
 * 内訳・明細の組み立て。金額は常にBigIntの円（`Number()`を通さない）。
 * REVERSAL（戻し）の明細は負の寄与として、支払った額・負担額の両方から引く。
 */

function yen(value: string): bigint {
  return yenFromDecimalString(value) ?? 0n;
}

/** 参加者の表示名。見つからないIDは「相手」とする（正本の2人以外は来ない）。 */
export function nameOf(
  participants: Participant[],
  userId: string,
): string {
  return (
    participants.find((participant) => participant.userId === userId)
      ?.displayName ?? "相手"
  );
}

export type PersonTotals = {
  /** 対象の支払いのうち、その人が払った額の合計（戻しは引く）。 */
  paid: bigint;
  /** 対象の支払いのうち、その人の負担額の合計（戻しは引く）。 */
  burden: bigint;
  /** paid − burden。正なら受け取る側、負なら渡す側。 */
  diff: bigint;
};

/** 対象明細から、その人の「支払った額・負担額・差」を計算する。 */
export function personTotalsOf(
  items: TargetItem[],
  userId: string,
): PersonTotals {
  let paid = 0n;
  let burden = 0n;
  for (const item of items) {
    const sign = item.kind === "REVERSAL" ? -1n : 1n;
    if (item.payment.payerUserId === userId) {
      paid += sign * yen(item.payment.amountYen);
    }
    for (const allocation of item.payment.allocations) {
      if (allocation.userId === userId) {
        burden += sign * yen(allocation.burdenYen);
      }
    }
  }
  return { paid, burden, diff: paid - burden };
}

/** 支払いの負担の分け方を「折半」「{name}が全額」「割合（…%）」の文字にする。 */
export function splitLabelOf(
  payment: Payment,
  participants: Participant[],
): string {
  const [first, second] = payment.allocations;
  if (first === undefined || second === undefined) {
    return "";
  }
  if (first.percent === 50 && second.percent === 50) {
    return "折半";
  }
  if (first.percent === 100) {
    return `${nameOf(participants, first.userId)} が全額`;
  }
  if (second.percent === 100) {
    return `${nameOf(participants, second.userId)} が全額`;
  }
  return `割合（${nameOf(participants, first.userId)} ${first.percent}%・${nameOf(participants, second.userId)} ${second.percent}%）`;
}

/** 明細1件の「{name} X円 · {name} Y円」。戻しは負の額で出す。 */
export function itemShareLabel(
  item: TargetItem,
  participants: Participant[],
): string {
  const sign = item.kind === "REVERSAL" ? -1n : 1n;
  return item.payment.allocations
    .map(
      (allocation) =>
        `${nameOf(participants, allocation.userId)} ${formatYen(sign * yen(allocation.burdenYen))}`,
    )
    .join(" · ");
}

/** 参加者番号（0・1）。見つからないときはnull。 */
export function slotOf(
  participants: Participant[],
  userId: string,
): number | null {
  return (
    participants.find((participant) => participant.userId === userId)?.slot ??
    null
  );
}

export type TransferDirection = {
  fromName: string;
  toName: string;
  amount: bigint;
};

/**
 * 一覧行の受け渡し文。向きが分かれば「AからBへX円」、
 * 参加者が取れないときは金額だけ、0円なら「受け渡し不要」。
 */
export function transferLabel(
  transfer: Transfer,
  participants: Participant[],
): string {
  const direction = transferDirectionOf(transfer, participants);
  if (direction !== null) {
    return `${direction.fromName} から ${direction.toName} へ ${formatYen(direction.amount)}`;
  }
  if (transfer.requiresTransfer) {
    return `${formatYen(yen(transfer.amountYen))} の受け渡し`;
  }
  return "受け渡し不要";
}

/**
 * 受け渡しの向きと金額。`requiresTransfer`がfalse（0円）ならnull。
 * 符号付きの残額の向きはサーバーの`fromUserId` / `toUserId`をそのまま使う。
 */
export function transferDirectionOf(
  transfer: Transfer,
  participants: Participant[],
): TransferDirection | null {
  if (
    !transfer.requiresTransfer ||
    transfer.fromUserId === null ||
    transfer.toUserId === null
  ) {
    return null;
  }
  return {
    fromName: nameOf(participants, transfer.fromUserId),
    toName: nameOf(participants, transfer.toUserId),
    amount: yen(transfer.amountYen),
  };
}

/** 完了要求のcompletionKind。非0円はtransfer_completed、0円はno_transfer_required。 */
export function completionKindOf(
  transfer: Transfer,
): SettlementCreateCompletionKind {
  return transfer.requiresTransfer
    ? "transfer_completed"
    : "no_transfer_required";
}

/** 支払いの表示名。labelが無いものは「支払い」とする。 */
export function paymentNameOf(payment: Payment): string {
  return payment.label ?? "支払い";
}
