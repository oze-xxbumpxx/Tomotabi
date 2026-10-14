import { Module } from "@nestjs/common";
import type { UnitOfWork } from "../../adapter/transaction/unit-of-work.js";
import { RecordCompositionModule } from "../../composition/record-composition.module.js";
import {
  CANCEL_PAYMENT_INPUT_PORT,
  type CancelPaymentInputPort,
} from "./adapter/inbound/cancel-payment.input-port.js";
import {
  CREATE_PAYMENT_INPUT_PORT,
  type CreatePaymentInputPort,
} from "./adapter/inbound/create-payment.input-port.js";
import {
  CANCEL_PLAN_EVENT_INPUT_PORT,
  type CancelPlanEventInputPort,
} from "./adapter/inbound/cancel-plan-event.input-port.js";
import {
  CREATE_PLAN_EVENT_INPUT_PORT,
  type CreatePlanEventInputPort,
} from "./adapter/inbound/create-plan-event.input-port.js";
import {
  GET_PAYMENT_INPUT_PORT,
  type GetPaymentInputPort,
} from "./adapter/inbound/get-payment.input-port.js";
import {
  LIST_RECORDS_INPUT_PORT,
  type ListRecordsInputPort,
} from "./adapter/inbound/list-records.input-port.js";
import {
  FINANCE_UNIT_OF_WORK,
  type FinanceWorkContext,
} from "./adapter/outbound/finance-work-context.js";
import {
  PLAN_EVENT_UNIT_OF_WORK,
  type PlanEventUnitOfWork,
} from "./adapter/outbound/plan-event-work-context.js";
import {
  RECORDS_READ_UNIT_OF_WORK,
  type RecordsReadUnitOfWork,
} from "./adapter/outbound/records-read.port.js";
import { WRITE_LOG, type WriteLog } from "../planning/adapter/outbound/write-log.port.js";
import {
  NOTIFICATION_PUBLISHER,
  type NotificationPublisher,
} from "./adapter/outbound/notification-publisher.js";
import { AchievementsController } from "./controller/achievements.controller.js";
import { BookingsController } from "./controller/bookings.controller.js";
import { PaymentsController } from "./controller/payments.controller.js";
import { RecordsController } from "./controller/records.controller.js";
import { CancelPaymentUseCase } from "./usecase/cancel-payment.usecase.js";
import { CancelPlanEventUseCase } from "./usecase/cancel-plan-event.usecase.js";
import { CreatePaymentUseCase } from "./usecase/create-payment.usecase.js";
import { CreatePlanEventUseCase } from "./usecase/create-plan-event.usecase.js";
import { GetPaymentUseCase } from "./usecase/get-payment.usecase.js";
import { ListRecordsUseCase } from "./usecase/list-records.usecase.js";

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
