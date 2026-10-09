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
  CANCEL_PLAN_EVENT_INPUT_PORT,
  type CancelPlanEventInputPort,
} from "./adapter/inbound/cancel-plan-event.input-port";
import {
  CREATE_PLAN_EVENT_INPUT_PORT,
  type CreatePlanEventInputPort,
} from "./adapter/inbound/create-plan-event.input-port";
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
  PLAN_EVENT_UNIT_OF_WORK,
  type PlanEventUnitOfWork,
} from "./adapter/outbound/plan-event-work-context";
import {
  RECORDS_READ_UNIT_OF_WORK,
  type RecordsReadUnitOfWork,
} from "./adapter/outbound/records-read.port";
import { WRITE_LOG, type WriteLog } from "../planning/adapter/outbound/write-log.port";
import {
  NOTIFICATION_PUBLISHER,
  type NotificationPublisher,
} from "./adapter/outbound/notification-publisher";
import { AchievementsController } from "./controller/achievements.controller";
import { BookingsController } from "./controller/bookings.controller";
import { PaymentsController } from "./controller/payments.controller";
import { RecordsController } from "./controller/records.controller";
import { CancelPaymentUseCase } from "./usecase/cancel-payment.usecase";
import { CancelPlanEventUseCase } from "./usecase/cancel-plan-event.usecase";
import { CreatePaymentUseCase } from "./usecase/create-payment.usecase";
import { CreatePlanEventUseCase } from "./usecase/create-plan-event.usecase";
import { GetPaymentUseCase } from "./usecase/get-payment.usecase";
import { ListRecordsUseCase } from "./usecase/list-records.usecase";

type WriteDeps = [
  uow: UnitOfWork<FinanceWorkContext>,
  writeLog: WriteLog,
  publisher: NotificationPublisher,
];
const WRITE_INJECT = [FINANCE_UNIT_OF_WORK, WRITE_LOG, NOTIFICATION_PUBLISHER];

type PlanEventWriteDeps = [
  uow: PlanEventUnitOfWork,
  writeLog: WriteLog,
  publisher: NotificationPublisher,
];
const PLAN_EVENT_INJECT = [
  PLAN_EVENT_UNIT_OF_WORK,
  WRITE_LOG,
  NOTIFICATION_PUBLISHER,
];

@Module({
  imports: [RecordCompositionModule],
  controllers: [
    PaymentsController,
    RecordsController,
    AchievementsController,
    BookingsController,
  ],
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
    // 達成・予約の付ける・取り消すは達成と予約で同じUseCase（URLの種類は
    // 入力のeventKind）。両方のコントローラから同じ口に入る。
    {
      provide: CREATE_PLAN_EVENT_INPUT_PORT,
      useFactory: (...deps: PlanEventWriteDeps): CreatePlanEventInputPort =>
        new CreatePlanEventUseCase(...deps),
      inject: PLAN_EVENT_INJECT,
    },
    {
      provide: CANCEL_PLAN_EVENT_INPUT_PORT,
      useFactory: (...deps: PlanEventWriteDeps): CancelPlanEventInputPort =>
        new CancelPlanEventUseCase(...deps),
      inject: PLAN_EVENT_INJECT,
    },
  ],
})
export class RecordModule {}
