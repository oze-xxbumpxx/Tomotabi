import { Module } from "@nestjs/common";
import type { UnitOfWork } from "../../adapter/transaction/unit-of-work";
import { RecordCompositionModule } from "../../composition/record-composition.module";
import {
  CANCEL_PAYMENT_INPUT_PORT,
  type CancelPaymentInputPort,
} from "./adapter/inbound/cancel-payment.input-port";
import {
  CREATE_PAYMENT_INPUT_PORT,
  type CreatePaymentInputPort,
} from "./adapter/inbound/create-payment.input-port";
import {
  GET_PAYMENT_INPUT_PORT,
  type GetPaymentInputPort,
} from "./adapter/inbound/get-payment.input-port";
import {
  FINANCE_UNIT_OF_WORK,
  type FinanceWorkContext,
} from "./adapter/outbound/finance-work-context";
import { WRITE_LOG, type WriteLog } from "../planning/adapter/outbound/write-log.port";
import { PaymentsController } from "./controller/payments.controller";
import { CancelPaymentUseCase } from "./usecase/cancel-payment.usecase";
import { CreatePaymentUseCase } from "./usecase/create-payment.usecase";
import { GetPaymentUseCase } from "./usecase/get-payment.usecase";

type WriteDeps = [
  uow: UnitOfWork<FinanceWorkContext>,
  writeLog: WriteLog,
];
const WRITE_INJECT = [FINANCE_UNIT_OF_WORK, WRITE_LOG];

@Module({
  imports: [RecordCompositionModule],
  controllers: [PaymentsController],
  providers: [
    {
      provide: CREATE_PAYMENT_INPUT_PORT,
      useFactory: (...deps: WriteDeps): CreatePaymentInputPort =>
        new CreatePaymentUseCase(...deps),
      inject: WRITE_INJECT,
    },
    {
      provide: GET_PAYMENT_INPUT_PORT,
      useFactory: (
        uow: UnitOfWork<FinanceWorkContext>,
      ): GetPaymentInputPort => new GetPaymentUseCase(uow),
      inject: [FINANCE_UNIT_OF_WORK],
    },
    {
      provide: CANCEL_PAYMENT_INPUT_PORT,
      useFactory: (...deps: WriteDeps): CancelPaymentInputPort =>
        new CancelPaymentUseCase(...deps),
      inject: WRITE_INJECT,
    },
  ],
})
export class RecordModule {}
