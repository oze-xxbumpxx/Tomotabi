import type { UserId } from "../../../../common/domain/user-id.js";
import type { IdempotencyKey } from "../../../../common/http/idempotency-key.js";
import type { PaymentCancellationResult } from "./payment-write.result.js";

export const CANCEL_PAYMENT_INPUT_PORT = Symbol("CANCEL_PAYMENT_INPUT_PORT");
export const CANCEL_PAYMENT_OPERATION = "cancelPayment";

export type CancelPaymentInput = Readonly<{
  userId: UserId;
  tripId: string;
  paymentId: string;
  key: IdempotencyKey;
  requestHash: string;
}>;

export interface CancelPaymentInputPort {
  execute(input: CancelPaymentInput): Promise<PaymentCancellationResult>;
}
