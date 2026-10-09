import { Module } from "@nestjs/common";
import type { Clock } from "../../adapter/clock/clock";
import { CLOCK } from "../../adapter/clock/clock";
import { SettlementCompositionModule } from "../../composition/settlement-composition.module";
import { WRITE_LOG, type WriteLog } from "../planning/adapter/outbound/write-log.port";
import {
  NOTIFICATION_PUBLISHER,
  type NotificationPublisher,
} from "./adapter/outbound/notification-publisher";
import {
  CANCEL_SETTLEMENT_INPUT_PORT,
  type CancelSettlementInputPort,
} from "./adapter/inbound/cancel-settlement.input-port";
import {
  COMPLETE_SETTLEMENT_INPUT_PORT,
  type CompleteSettlementInputPort,
} from "./adapter/inbound/complete-settlement.input-port";
import {
  CREATE_PREVIEW_INPUT_PORT,
  type CreatePreviewInputPort,
} from "./adapter/inbound/create-preview.input-port";
import {
  GET_BALANCE_INPUT_PORT,
  type GetBalanceInputPort,
} from "./adapter/inbound/get-balance.input-port";
import {
  GET_PREVIEW_INPUT_PORT,
  type GetPreviewInputPort,
} from "./adapter/inbound/get-preview.input-port";
import {
  GET_SETTLEMENT_INPUT_PORT,
  type GetSettlementInputPort,
} from "./adapter/inbound/get-settlement.input-port";
import {
  LIST_PREVIEWS_INPUT_PORT,
  type ListPreviewsInputPort,
} from "./adapter/inbound/list-previews.input-port";
import {
  LIST_SETTLEMENTS_INPUT_PORT,
  type ListSettlementsInputPort,
} from "./adapter/inbound/list-settlements.input-port";
import {
  SETTLEMENT_READ_UNIT_OF_WORK,
  SETTLEMENT_UNIT_OF_WORK,
  type SettlementReadUnitOfWork,
  type SettlementUnitOfWork,
} from "./adapter/outbound/settlement-work-context";
import { BalanceController } from "./controller/balance.controller";
import { PreviewsController } from "./controller/previews.controller";
import { SettlementsController } from "./controller/settlements.controller";
import { CancelSettlementUseCase } from "./usecase/cancel-settlement.usecase";
import { CompleteSettlementUseCase } from "./usecase/complete-settlement.usecase";
import { CreatePreviewUseCase } from "./usecase/create-preview.usecase";
import { GetBalanceUseCase } from "./usecase/get-balance.usecase";
import { GetPreviewUseCase } from "./usecase/get-preview.usecase";
import { GetSettlementUseCase } from "./usecase/get-settlement.usecase";
import { ListPreviewsUseCase } from "./usecase/list-previews.usecase";
import { ListSettlementsUseCase } from "./usecase/list-settlements.usecase";

@Module({
  imports: [SettlementCompositionModule],
  controllers: [BalanceController, PreviewsController, SettlementsController],
  providers: [
    {
      provide: GET_BALANCE_INPUT_PORT,
      useFactory: (
        read: SettlementReadUnitOfWork,
        clock: Clock,
      ): GetBalanceInputPort => new GetBalanceUseCase(read, clock),
      inject: [SETTLEMENT_READ_UNIT_OF_WORK, CLOCK],
    },
    {
      provide: CREATE_PREVIEW_INPUT_PORT,
      useFactory: (
        uow: SettlementUnitOfWork,
        writeLog: WriteLog,
      ): CreatePreviewInputPort =>
        new CreatePreviewUseCase(uow, writeLog),
      inject: [SETTLEMENT_UNIT_OF_WORK, WRITE_LOG],
    },
    {
      provide: LIST_PREVIEWS_INPUT_PORT,
      useFactory: (
        read: SettlementReadUnitOfWork,
      ): ListPreviewsInputPort => new ListPreviewsUseCase(read),
      inject: [SETTLEMENT_READ_UNIT_OF_WORK],
    },
    {
      provide: GET_PREVIEW_INPUT_PORT,
      useFactory: (
        read: SettlementReadUnitOfWork,
      ): GetPreviewInputPort => new GetPreviewUseCase(read),
      inject: [SETTLEMENT_READ_UNIT_OF_WORK],
    },
    {
      provide: COMPLETE_SETTLEMENT_INPUT_PORT,
      useFactory: (
        uow: SettlementUnitOfWork,
        writeLog: WriteLog,
        publisher: NotificationPublisher,
      ): CompleteSettlementInputPort =>
        new CompleteSettlementUseCase(uow, writeLog, publisher),
      inject: [SETTLEMENT_UNIT_OF_WORK, WRITE_LOG, NOTIFICATION_PUBLISHER],
    },
    {
      provide: LIST_SETTLEMENTS_INPUT_PORT,
      useFactory: (
        read: SettlementReadUnitOfWork,
      ): ListSettlementsInputPort => new ListSettlementsUseCase(read),
      inject: [SETTLEMENT_READ_UNIT_OF_WORK],
    },
    {
      provide: GET_SETTLEMENT_INPUT_PORT,
      useFactory: (
        read: SettlementReadUnitOfWork,
      ): GetSettlementInputPort => new GetSettlementUseCase(read),
      inject: [SETTLEMENT_READ_UNIT_OF_WORK],
    },
    {
      provide: CANCEL_SETTLEMENT_INPUT_PORT,
      useFactory: (
        uow: SettlementUnitOfWork,
        writeLog: WriteLog,
        publisher: NotificationPublisher,
      ): CancelSettlementInputPort =>
        new CancelSettlementUseCase(uow, writeLog, publisher),
      inject: [SETTLEMENT_UNIT_OF_WORK, WRITE_LOG, NOTIFICATION_PUBLISHER],
    },
  ],
})
export class SettlementModule {}
