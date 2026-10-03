import type { Settlement } from "@tomotabi/contracts";
import { ApiError } from "../../../common/http/api-error";
import type { PaymentCancellation } from "../../record/domain/payment";
import { tripNotAccessible } from "../../planning/usecase/trip-write-flow";
import type {
  GetSettlementInput,
  GetSettlementInputPort,
} from "../adapter/inbound/get-settlement.input-port";
import type { SettlementReadUnitOfWork } from "../adapter/outbound/settlement-work-context";
import { joinPreviewItems, toSettlementDto } from "./settlement-dto";

export function settlementNotFound(): ApiError {
  return new ApiError({
    code: "SETTLEMENT_NOT_FOUND",
    status: 404,
    message: "Settlement not found",
  });
}

/**
 * 精算の取得（F-34）。元の明細・記録した人・取り消し履歴を返す。
 * 無い・別の旅行の精算は同じ404（存在を漏らさない）。
 */
export class GetSettlementUseCase implements GetSettlementInputPort {
  constructor(private readonly unitOfWork: SettlementReadUnitOfWork) {}

  async execute(input: GetSettlementInput): Promise<Settlement> {
    return this.unitOfWork.run(async (ctx) => {
      const roster = await ctx.roster.find(input.tripId, input.userId);
      if (roster === null) {
        throw tripNotAccessible();
      }
      const settlement = await ctx.settlements.findSettlementInTrip(
        input.tripId,
        input.settlementId,
      );
      if (settlement === null) {
        throw settlementNotFound();
      }
      const itemRows =
        (await ctx.settlements.listSettlementItems(input.tripId, [
          settlement.id,
        ])).get(settlement.id) ?? [];
      const payments = await ctx.paymentsRead.listInTrip(input.tripId);
      const cancellations = await ctx.paymentsRead.listCancellationsInTrip(
        input.tripId,
      );
      const cancellation = await ctx.settlements.findSettlementCancellation(
        input.tripId,
        settlement.id,
      );
      const latestActive = await ctx.settlements.findLatestActiveSettlement(
        input.tripId,
      );
      const paymentsById = new Map(
        payments.map((payment) => [payment.id, payment]),
      );
      const cancellationsById = new Map<string, PaymentCancellation>(
        cancellations.map((entry) => [entry.paymentId, entry]),
      );
      return toSettlementDto(
        settlement,
        joinPreviewItems(itemRows, paymentsById, cancellationsById),
        cancellation,
        latestActive,
        roster,
      );
    });
  }
}
