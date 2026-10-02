import type { Cancellation, Payment } from "@tomotabi/contracts";

/**
 * 支払いの書き込み UseCase の結果。receipt に保存したものと同じ
 * httpStatus・body を持つ。
 */
export type PaymentWriteResult = Readonly<{
  httpStatus: 200 | 201;
  body: Payment;
}>;

/** 支払いの取り消し UseCase の結果。2 回目以降は 200 で既存の取り消し。 */
export type PaymentCancellationResult = Readonly<{
  httpStatus: 200 | 201;
  body: Cancellation;
}>;
