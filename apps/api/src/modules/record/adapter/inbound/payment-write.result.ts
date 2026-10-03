import type { Cancellation, Payment } from "@tomotabi/contracts";

/**
 * 支払いの書き込みUseCaseの結果。receiptに保存したものと同じ
 * httpStatus・bodyを持つ。
 */
export type PaymentWriteResult = Readonly<{
  httpStatus: 200 | 201;
  body: Payment;
}>;

/** 支払いの取り消しUseCaseの結果。2回目以降は200で既存の取り消し。 */
export type PaymentCancellationResult = Readonly<{
  httpStatus: 200 | 201;
  body: Cancellation;
}>;
