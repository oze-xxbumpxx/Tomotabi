import type { Cancellation } from "@tomotabi/contracts";
import type { UnitOfWork } from "../../../adapter/transaction/unit-of-work";
import {
  CANCEL_PAYMENT_OPERATION,
  type CancelPaymentInput,
  type CancelPaymentInputPort,
} from "../adapter/inbound/cancel-payment.input-port";
import type { PaymentCancellationResult } from "../adapter/inbound/payment-write.result";
import type { FinanceWorkContext } from "../adapter/outbound/finance-work-context";
import type { WriteLog } from "../../planning/adapter/outbound/write-log.port";
import {
  executeFinanceWrite,
  runFinanceWrite,
  type FinanceWriteOutcome,
} from "./finance-write-flow";
import { paymentNotFound } from "./get-payment.usecase";
import { toCancellationDto } from "./payment-dto";

/**
 * 支払いの取り消し。取り消しは別の記録を足す形（元の支払いの行は残る）。
 * 既に取り消し済みなら既存の取り消し記録を 200 で返す（1 支払い 1 取消）。
 */
export class CancelPaymentUseCase implements CancelPaymentInputPort {
  constructor(
    private readonly unitOfWork: UnitOfWork<FinanceWorkContext>,
    private readonly writeLog: WriteLog,
  ) {}

  execute(input: CancelPaymentInput): Promise<PaymentCancellationResult> {
    return executeFinanceWrite(
      this.writeLog,
      CANCEL_PAYMENT_OPERATION,
      input.tripId,
      input.paymentId,
      () => this.run(input),
    );
  }

  private run(
    input: CancelPaymentInput,
  ): Promise<FinanceWriteOutcome<Cancellation>> {
    return this.unitOfWork.run((ctx) =>
      runFinanceWrite<Cancellation>(
        ctx,
        {
          userId: input.userId,
          tripId: input.tripId,
          operation: CANCEL_PAYMENT_OPERATION,
          key: input.key,
          requestHash: input.requestHash,
        },
        async (work) => {
          const payment = await work.payments.findInTrip(
            input.tripId,
            input.paymentId,
          );
          if (payment === null) {
            throw paymentNotFound();
          }
          const existing = await work.payments.findCancellationInTrip(
            input.tripId,
            payment.id,
          );
          if (existing !== null) {
            return {
              body: toCancellationDto(existing),
              httpStatus: 200,
              resourceType: "payment_cancellation",
              resourceId: payment.id,
            };
          }
          const cancellation = await work.payments.insertCancellation({
            paymentId: payment.id,
            tripId: input.tripId,
            cancelledBy: input.userId,
          });
          return {
            body: toCancellationDto(cancellation),
            httpStatus: 201,
            resourceType: "payment_cancellation",
            resourceId: payment.id,
          };
        },
      ),
    );
  }
}
