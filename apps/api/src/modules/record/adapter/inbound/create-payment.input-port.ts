import type { UserId } from "../../../../common/domain/user-id";
import type { IdempotencyKey } from "../../../../common/http/idempotency-key";
import type { PaymentWriteResult } from "./payment-write.result";

export const CREATE_PAYMENT_INPUT_PORT = Symbol("CREATE_PAYMENT_INPUT_PORT");
export const CREATE_PAYMENT_OPERATION = "createPayment";

/** 負担の割合1人分（契約のallocationsの項目）。percentは検証前の生の値。 */
export type CreatePaymentAllocation = Readonly<{
  userId: string;
  percent: number;
}>;

export type CreatePaymentInput = Readonly<{
  userId: UserId;
  tripId: string;
  key: IdempotencyKey;
  requestHash: string;
  amountYen: string;
  payerUserId: string;
  allocations: readonly CreatePaymentAllocation[];
  label: string | null;
  planId: string | null;
}>;

export interface CreatePaymentInputPort {
  execute(input: CreatePaymentInput): Promise<PaymentWriteResult>;
}
