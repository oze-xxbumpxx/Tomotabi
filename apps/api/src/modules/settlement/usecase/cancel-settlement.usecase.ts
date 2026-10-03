import type { Cancellation } from "@tomotabi/contracts";
import { ApiError } from "../../../common/http/api-error";
import type { WriteLog } from "../../planning/adapter/outbound/write-log.port";
import {
  executeFinanceWrite,
  runFinanceWriteTransaction,
  type FinanceWritePersist,
} from "../../record/usecase/finance-write-flow";
import {
  CANCEL_SETTLEMENT_OPERATION,
  type CancelSettlementInput,
  type CancelSettlementInputPort,
} from "../adapter/inbound/cancel-settlement.input-port";
import type {
  SettlementUnitOfWork,
  SettlementWorkContext,
} from "../adapter/outbound/settlement-work-context";
import { settlementNotFound } from "./get-settlement.usecase";
import { toSettlementCancellationDto } from "./settlement-dto";

/**
 * 精算の取り消し（F-35・F-36、E-09）。お金の書き込みの共通の流れに乗せ、
 * 取り消しの追記とその精算の占有の削除を同じトランザクションで行う
 * （占有を先に消して別のトランザクションで取り消しを書く構成は禁止）。
 *
 * 取り消せるのは最新の有効な精算だけ（旅行内連番の最大）。それ以外は
 * 409 SETTLEMENT_NOT_LATEST。取り消し済みなら200で既存の取り消しを
 * 返す（1精算1取消）。
 */
export class CancelSettlementUseCase implements CancelSettlementInputPort {
  constructor(
    private readonly unitOfWork: SettlementUnitOfWork,
    private readonly writeLog: WriteLog,
  ) {}

  async execute(
    input: CancelSettlementInput,
  ): Promise<{ httpStatus: 200 | 201; body: Cancellation }> {
    return executeFinanceWrite(
      this.writeLog,
      CANCEL_SETTLEMENT_OPERATION,
      input.tripId,
      input.settlementId,
      () =>
        runFinanceWriteTransaction<Cancellation, SettlementWorkContext>(
          this.unitOfWork,
          {
            userId: input.userId,
            tripId: input.tripId,
            operation: CANCEL_SETTLEMENT_OPERATION,
            key: input.key,
            requestHash: input.requestHash,
          },
          (ctx) => this.persist(ctx, input),
        ),
    );
  }

  private async persist(
    ctx: SettlementWorkContext,
    input: CancelSettlementInput,
  ): Promise<FinanceWritePersist<Cancellation>> {
    const settlement = await ctx.settlements.findSettlementInTrip(
      input.tripId,
      input.settlementId,
    );
    if (settlement === null) {
      throw settlementNotFound();
    }
    const existing = await ctx.settlements.findSettlementCancellation(
      input.tripId,
      settlement.id,
    );
    if (existing !== null) {
      return {
        body: toSettlementCancellationDto(existing),
        httpStatus: 200,
        resourceType: "settlement_cancellation",
        resourceId: settlement.id,
      };
    }
    const latestActive = await ctx.settlements.findLatestActiveSettlement(
      input.tripId,
    );
    if (latestActive === null || latestActive.id !== settlement.id) {
      throw new ApiError({
        code: "SETTLEMENT_NOT_LATEST",
        status: 409,
        message: "Only the latest active settlement can be cancelled",
      });
    }
    const cancellation = await ctx.settlements.insertSettlementCancellation({
      settlementId: settlement.id,
      tripId: input.tripId,
      cancelledBy: input.userId,
    });
    await ctx.settlements.deleteActiveClaimsForSettlement(
      input.tripId,
      settlement.id,
    );
    return {
      body: toSettlementCancellationDto(cancellation),
      httpStatus: 201,
      resourceType: "settlement_cancellation",
      resourceId: settlement.id,
    };
  }
}
