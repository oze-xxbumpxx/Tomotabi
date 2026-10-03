import type { Payment as PaymentContract } from "@tomotabi/contracts";
import { ApiError } from "../../../common/http/api-error";
import type { UnitOfWork } from "../../../adapter/transaction/unit-of-work";
import {
  CREATE_PAYMENT_OPERATION,
  type CreatePaymentInput,
  type CreatePaymentInputPort,
} from "../adapter/inbound/create-payment.input-port";
import type { PaymentWriteResult } from "../adapter/inbound/payment-write.result";
import type { FinanceWorkContext } from "../adapter/outbound/finance-work-context";
import type { WriteLog } from "../../planning/adapter/outbound/write-log.port";
import { Payment } from "../domain/payment";
import {
  executeFinanceWrite,
  runFinanceWriteTransaction,
  type FinanceWriteOutcome,
} from "./finance-write-flow";
import {
  parseAmountYen,
  parsePaymentLabel,
  payerSlotOf,
  slot0PercentOf,
} from "./payment-input";
import { toPaymentDto } from "./payment-dto";

/**
 * 支払いの記録。負担額・寄与はサーバーが計算して確定する
 * （クライアントの申告で確定しない）。払った人・分け方の検証は
 * guardの行のロックのあとで行う（同じ旅行の書き込みを一列に並べる）。
 */
export class CreatePaymentUseCase implements CreatePaymentInputPort {
  constructor(
    private readonly unitOfWork: UnitOfWork<FinanceWorkContext>,
    private readonly writeLog: WriteLog,
  ) {}

  execute(input: CreatePaymentInput): Promise<PaymentWriteResult> {
    return executeFinanceWrite(
      this.writeLog,
      CREATE_PAYMENT_OPERATION,
      input.tripId,
      null,
      () => this.run(input),
    );
  }

  private async run(
    input: CreatePaymentInput,
  ): Promise<FinanceWriteOutcome<PaymentContract>> {
    const amount = parseAmountYen(input.amountYen);
    const label = parsePaymentLabel(input.label);
    return runFinanceWriteTransaction<PaymentContract>(
      this.unitOfWork,
      {
        userId: input.userId,
        tripId: input.tripId,
        operation: CREATE_PAYMENT_OPERATION,
        key: input.key,
        requestHash: input.requestHash,
      },
        async (work, roster) => {
          const payerSlot = payerSlotOf(roster, input.payerUserId);
          const slot0Percent = slot0PercentOf(roster, input.allocations);
          if (
            input.planId !== null &&
            !(await work.plans.existsInTrip(input.tripId, input.planId))
          ) {
            throw new ApiError({
              code: "VALIDATION_FAILED",
              status: 422,
              message: "planId must be a plan of the trip",
            });
          }
          const payment = await work.payments.insert(
            Payment.create({
              tripId: input.tripId,
              planId: input.planId,
              amount,
              payerSlot,
              slot0Percent,
              label,
              createdBy: input.userId,
            }),
          );
          const body = toPaymentDto(payment, roster, null);
          return {
            body,
            httpStatus: 201,
            resourceType: "payment",
            resourceId: payment.id,
          };
      },
    );
  }
}
