import { Module } from "@nestjs/common";
import type { Clock } from "../../adapter/clock/clock";
import { CLOCK } from "../../adapter/clock/clock";
import { SettlementCompositionModule } from "../../composition/settlement-composition.module";
import { WRITE_LOG, type WriteLog } from "../planning/adapter/outbound/write-log.port";
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
  LIST_PREVIEWS_INPUT_PORT,
  type ListPreviewsInputPort,
} from "./adapter/inbound/list-previews.input-port";
import {
  SETTLEMENT_READ_UNIT_OF_WORK,
  SETTLEMENT_UNIT_OF_WORK,
  type SettlementReadUnitOfWork,
  type SettlementUnitOfWork,
} from "./adapter/outbound/settlement-work-context";
import { BalanceController } from "./controller/balance.controller";
import { PreviewsController } from "./controller/previews.controller";
import { CreatePreviewUseCase } from "./usecase/create-preview.usecase";
import { GetBalanceUseCase } from "./usecase/get-balance.usecase";
import { GetPreviewUseCase } from "./usecase/get-preview.usecase";
import { ListPreviewsUseCase } from "./usecase/list-previews.usecase";

@Module({
  imports: [SettlementCompositionModule],
  controllers: [BalanceController, PreviewsController],
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
  ],
})
export class SettlementModule {}
