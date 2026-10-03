import type { Preview } from "@tomotabi/contracts";
import { ApiError } from "../../../common/http/api-error";
import { tripNotAccessible } from "../../planning/usecase/trip-write-flow";
import { validatePreview } from "../domain/preview-validation";
import type {
  GetPreviewInput,
  GetPreviewInputPort,
} from "../adapter/inbound/get-preview.input-port";
import type { SettlementReadUnitOfWork } from "../adapter/outbound/settlement-work-context";
import { currentClaimStates } from "./current-claims";
import { joinPreviewItems, toPreviewDto } from "./settlement-dto";

/**
 * 確認の取得（F-23）。固定した明細と、取得時点の検証結果を返す。
 * 明細・金額は変わらない（F-21）。無い・別の旅行の確認は同じ 404。
 */
export class GetPreviewUseCase implements GetPreviewInputPort {
  constructor(private readonly unitOfWork: SettlementReadUnitOfWork) {}

  async execute(input: GetPreviewInput): Promise<Preview> {
    return this.unitOfWork.run(async (ctx) => {
      const roster = await ctx.roster.find(input.tripId, input.userId);
      if (roster === null) {
        throw tripNotAccessible();
      }
      const preview = await ctx.settlements.findPreviewInTrip(
        input.tripId,
        input.previewId,
      );
      if (preview === null) {
        throw new ApiError({
          code: "PREVIEW_NOT_FOUND",
          status: 404,
          message: "Preview not found",
        });
      }
      const itemRows =
        (await ctx.settlements.listPreviewItems(input.tripId, [
          input.previewId,
        ])).get(input.previewId) ?? [];
      const payments = await ctx.paymentsRead.listInTrip(input.tripId);
      const cancellations = await ctx.paymentsRead.listCancellationsInTrip(
        input.tripId,
      );
      const cancelledIds = new Set(
        cancellations.map((cancellation) => cancellation.paymentId),
      );
      const histories = await ctx.settlements.claimHistories(
        input.tripId,
        itemRows.map((item) => item.paymentId),
      );
      const existingSettlement = await ctx.settlements.findSettlementForPreview(
        input.tripId,
        input.previewId,
      );
      const validation = validatePreview(
        itemRows,
        currentClaimStates(
          itemRows.map((item) => item.paymentId),
          histories,
          cancelledIds,
        ),
        existingSettlement,
      );
      const joined = joinPreviewItems(
        itemRows,
        new Map(payments.map((payment) => [payment.id, payment])),
        new Map(
          cancellations.map((cancellation) => [
            cancellation.paymentId,
            cancellation,
          ]),
        ),
      );
      return toPreviewDto(preview, joined, roster, validation);
    });
  }
}
