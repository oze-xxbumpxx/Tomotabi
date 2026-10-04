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
  LIST_RECORDS_INPUT_PORT,
  type ListRecordsInputPort,
} from "./adapter/inbound/list-records.input-port";
import {
  FINANCE_UNIT_OF_WORK,
  type FinanceWorkContext,
} from "./adapter/outbound/finance-work-context";
import {
  RECORDS_READ_UNIT_OF_WORK,
  type RecordsReadUnitOfWork,
} from "./adapter/outbound/records-read.port";
import { WRITE_LOG, type WriteLog } from "../planning/adapter/outbound/write-log.port";
import { PaymentsController } from "./controller/payments.controller";
import { RecordsController } from "./controller/records.controller";
import { CancelPaymentUseCase } from "./usecase/cancel-payment.usecase";
import { CreatePaymentUseCase } from "./usecase/create-payment.usecase";
import { GetPaymentUseCase } from "./usecase/get-payment.usecase";
import { ListRecordsUseCase } from "./usecase/list-records.usecase";

type WriteDeps = [
  uow: UnitOfWork<FinanceWorkContext>,
  writeLog: WriteLog,
];
const WRITE_INJECT = [FINANCE_UNIT_OF_WORK, WRITE_LOG];

@Module({
  imports: [RecordCompositionModule],
  controllers: [PaymentsController, RecordsController],
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
    {
      provide: LIST_RECORDS_INPUT_PORT,
      useFactory: (
        uow: RecordsReadUnitOfWork,
      ): ListRecordsInputPort => new ListRecordsUseCase(uow),
      inject: [RECORDS_READ_UNIT_OF_WORK],
    },
  ],
})
export class RecordModule {}
