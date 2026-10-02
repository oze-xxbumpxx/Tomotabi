import type { BoundedText } from "../../../common/domain/bounded-text";
import type { ParticipantSlot } from "../../../common/domain/participant-slot";
import type { UserId } from "../../../common/domain/user-id";
import type { PaymentYen } from "../../../common/domain/yen";
import { SignedYen } from "../../../common/domain/yen";

/**
 * 支払い 1 件（record.payments）。
 * 負担額と寄与は保存時に確定する（F-04・F-05）。取り消しは別の記録
 * （record.payment_cancellations）で、支払いの行自体は変わらない。
 */
export type Payment = Readonly<{
  id: string;
  tripId: string;
  planId: string | null;
  amount: PaymentYen;
  payerSlot: ParticipantSlot;
  /** 参加者番号 0 の人の負担の割合（0〜100 の整数）。もう一人は 100 から引いた値。 */
  slot0Percent: number;
  /** 0 以上。slot0Burden + slot1Burden = amount。 */
  slot0Burden: SignedYen;
  slot1Burden: SignedYen;
  /** 参加者番号 1 の人から 0 の人へ渡す向きを正とする、貸し借りへの寄与。 */
  contribution: SignedYen;
  label: BoundedText | null;
  createdBy: UserId;
  createdAt: Date;
}>;

export type NewPayment = Omit<Payment, "id" | "createdAt">;

/**
 * 支払いの取り消し記録（record.payment_cancellations）。1 支払い 1 記録
 * （payment_id が PK）。元の支払いの行は残る。
 */
export type PaymentCancellation = Readonly<{
  paymentId: string;
  tripId: string;
  cancelledBy: UserId;
  createdAt: Date;
}>;

export type NewPaymentCancellation = Omit<PaymentCancellation, "createdAt">;

export const Payment = {
  /**
   * 負担額と寄与を計算して支払いを組み立てる。
   * - 払った人でない人の負担 = floor(金額 × その人の割合 ÷ 100)（端数は切り捨て）
   * - 払った人の負担 = 金額 − もう一人の負担（端数は払った人が引き受ける）
   * - 寄与 = 払った人が 0 なら 1 の人の負担、1 なら 0 の人の負担の負値
   * @throws slot0Percent が 0〜100 の整数でないとき Error を投げる。
   */
  create(input: {
    tripId: string;
    planId: string | null;
    amount: PaymentYen;
    payerSlot: ParticipantSlot;
    slot0Percent: number;
    label: BoundedText | null;
    createdBy: UserId;
  }): NewPayment {
    const { amount, payerSlot, slot0Percent } = input;
    if (
      !Number.isInteger(slot0Percent) ||
      slot0Percent < 0 ||
      slot0Percent > 100
    ) {
      throw new Error("slot0Percent must be an integer between 0 and 100");
    }
    let slot0Burden: SignedYen;
    let slot1Burden: SignedYen;
    let contribution: SignedYen;
    if (payerSlot === 0) {
      // 払った人でないのは 1 の人。その割合は 100 - slot0Percent
      slot1Burden = SignedYen.fromBigInt(
        (amount * BigInt(100 - slot0Percent)) / 100n,
      );
      slot0Burden = SignedYen.fromBigInt(amount - slot1Burden);
      contribution = slot1Burden;
    } else {
      slot0Burden = SignedYen.fromBigInt(
        (amount * BigInt(slot0Percent)) / 100n,
      );
      slot1Burden = SignedYen.fromBigInt(amount - slot0Burden);
      contribution = SignedYen.negate(slot0Burden);
    }
    return {
      tripId: input.tripId,
      planId: input.planId,
      amount,
      payerSlot,
      slot0Percent,
      slot0Burden,
      slot1Burden,
      contribution,
      label: input.label,
      createdBy: input.createdBy,
    };
  },
};
