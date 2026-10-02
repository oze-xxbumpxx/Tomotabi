import type {
  NewPayment,
  NewPaymentCancellation,
  Payment,
  PaymentCancellation,
} from "../../domain/payment";

/**
 * 支払いとその取り消しの保存。record.payments・record.payment_cancellations は
 * 追記のみの履歴表で、更新・削除はしない（取り消しは別の記録を足す形）。
 */
export interface PaymentRepository {
  /** 支払いを追加して、DB が埋めた値（id・createdAt）を含めて返す。 */
  insert(payment: NewPayment): Promise<Payment>;
  /**
   * 同じ旅行の中の支払いを 1 件返す。別の旅行の支払い・無い支払いは null
   * （呼び出し側が同じ形の 404 に写し、存在を漏らさない）。
   */
  findInTrip(tripId: string, paymentId: string): Promise<Payment | null>;
  /** 支払いの取り消し記録。無ければ null。 */
  findCancellationInTrip(
    tripId: string,
    paymentId: string,
  ): Promise<PaymentCancellation | null>;
  /** 取り消し記録を追加して、DB が埋めた値（createdAt）を含めて返す。 */
  insertCancellation(
    cancellation: NewPaymentCancellation,
  ): Promise<PaymentCancellation>;
}
