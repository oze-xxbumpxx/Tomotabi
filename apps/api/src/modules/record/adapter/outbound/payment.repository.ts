import type {
  NewPayment,
  NewPaymentCancellation,
  Payment,
  PaymentCancellation,
} from "../../domain/payment";

/**
 * 支払いとその取り消しの保存。record.payments・record.payment_cancellationsは
 * 追記のみの履歴表で、更新・削除はしない（取り消しは別の記録を足す形）。
 */
export interface PaymentRepository {
  /** 支払いを追加して、DBが埋めた値（id・createdAt）を含めて返す。 */
  insert(payment: NewPayment): Promise<Payment>;
  /**
   * 同じ旅行の中の支払いを1件返す。別の旅行の支払い・無い支払いはnull
   * （呼び出し側が同じ形の404に写し、存在を漏らさない）。
   */
  findInTrip(tripId: string, paymentId: string): Promise<Payment | null>;
  /** 支払いの取り消し記録。無ければnull。 */
  findCancellationInTrip(
    tripId: string,
    paymentId: string,
  ): Promise<PaymentCancellation | null>;
  /** 取り消し記録を追加して、DBが埋めた値（createdAt）を含めて返す。 */
  insertCancellation(
    cancellation: NewPaymentCancellation,
  ): Promise<PaymentCancellation>;
}
