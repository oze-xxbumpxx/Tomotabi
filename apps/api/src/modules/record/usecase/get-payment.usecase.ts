import type { Payment as PaymentContract } from "@tomotabi/contracts";
import { ApiError } from "../../../common/http/api-error";
import type { UnitOfWork } from "../../../adapter/transaction/unit-of-work";
import { tripNotAccessible } from "../../planning/usecase/trip-write-flow";
import type {
  GetPaymentInput,
  GetPaymentInputPort,
} from "../adapter/inbound/get-payment.input-port";
import type { FinanceWorkContext } from "../adapter/outbound/finance-work-context";
import { toPaymentDto } from "./payment-dto";

/**
 * 参加している旅行の中で、支払いが無い・別の旅行の支払いはどちらも
 * 同じ 404（どちらも同じ応答で、存在を漏らさない）。
 */
export function paymentNotFound(): ApiError {
  return new ApiError({
    code: "PAYMENT_NOT_FOUND",
    status: 404,
    message: "Payment was not found in the trip",
  });
}

/**
 * 支払い 1 件の取得（取り消し状態を含む）。読み取りだけなので
 * guard の行のロックは取らない。
 */
export class GetPaymentUseCase implements GetPaymentInputPort {
  constructor(
    private readonly unitOfWork: UnitOfWork<FinanceWorkContext>,
  ) {}

  execute(input: GetPaymentInput): Promise<PaymentContract> {
    return this.unitOfWork.run(async (ctx) => {
      const roster = await ctx.roster.find(input.tripId, input.userId);
      if (roster === null) {
        throw tripNotAccessible();
      }
      const payment = await ctx.payments.findInTrip(
        input.tripId,
        input.paymentId,
      );
      if (payment === null) {
        throw paymentNotFound();
      }
      const cancellation = await ctx.payments.findCancellationInTrip(
        input.tripId,
        payment.id,
      );
      return toPaymentDto(payment, roster, cancellation);
    });
  }
}
