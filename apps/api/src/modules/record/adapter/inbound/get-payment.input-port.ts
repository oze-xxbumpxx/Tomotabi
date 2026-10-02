import type { Payment } from "@tomotabi/contracts";
import type { UserId } from "../../../../common/domain/user-id";

export const GET_PAYMENT_INPUT_PORT = Symbol("GET_PAYMENT_INPUT_PORT");

export type GetPaymentInput = Readonly<{
  userId: UserId;
  tripId: string;
  paymentId: string;
}>;

export interface GetPaymentInputPort {
  execute(input: GetPaymentInput): Promise<Payment>;
}
