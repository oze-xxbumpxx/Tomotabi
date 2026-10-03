import type { PreviewPage } from "@tomotabi/contracts";
import { tripNotAccessible } from "../../planning/usecase/trip-write-flow";
import { validatePreview } from "../domain/preview-validation";
import type {
  ListPreviewsInput,
  ListPreviewsInputPort,
} from "../adapter/inbound/list-previews.input-port";
import type { PreviewAnchor } from "../adapter/outbound/settlement.repository";
import type {
  SettlementReadContext,
  SettlementReadUnitOfWork,
} from "../adapter/outbound/settlement-work-context";
import { currentClaimStates } from "./current-claims";
import {
  decodePreviewCursor,
  encodePreviewCursor,
  invalidPreviewCursor,
} from "./preview-cursor";
import { toPreviewSummaryDto } from "./settlement-dto";

/**
 * 確認の一覧（F-22・未決事項3）。自分が作った未完了の確認だけを
 * 新しい順に返す。一覧に出る確認は精算がまだ無いものだけなので、
 * 検証結果のexistingSettlementは常にnull。
 */
export class ListPreviewsUseCase implements ListPreviewsInputPort {
  constructor(private readonly unitOfWork: SettlementReadUnitOfWork) {}

  async execute(input: ListPreviewsInput): Promise<PreviewPage> {
    return this.unitOfWork.run(async (ctx) => {
      const roster = await ctx.roster.find(input.tripId, input.userId);
      if (roster === null) {
        throw tripNotAccessible();
      }
      const after = await this.anchor(ctx, input);
      const page = await ctx.settlements.listPendingPreviews(
        input.tripId,
        input.userId,
        after,
        input.limit,
      );

      const cancellations = await ctx.paymentsRead.listCancellationsInTrip(
        input.tripId,
      );
      const cancelledIds = new Set(
        cancellations.map((cancellation) => cancellation.paymentId),
      );
      const itemsByPreview = await ctx.settlements.listPreviewItems(
        input.tripId,
        page.items.map((preview) => preview.id),
      );
      const paymentIds = [
        ...new Set(
          [...itemsByPreview.values()]
            .flat()
            .map((item) => item.paymentId),
        ),
      ];
      const histories = await ctx.settlements.claimHistories(
        input.tripId,
        paymentIds,
      );
      const current = currentClaimStates(
        paymentIds,
        histories,
        cancelledIds,
      );

      const items = page.items.map((preview) => {
        const previewItems = itemsByPreview.get(preview.id) ?? [];
        const validation = validatePreview(previewItems, current, null);
        return toPreviewSummaryDto(
          preview,
          previewItems.length,
          roster,
          validation,
        );
      });
      return {
        items,
        nextCursor:
          page.nextCursorId === null
            ? null
            : encodePreviewCursor(page.nextCursorId),
      };
    });
  }

  /**
   * カーソルの起点を自分の確認から引く。形が不正・起点が無い・
   * 他人の確認を指すカーソルは400（一覧の続きを偽造できない）。
   */
  private async anchor(
    ctx: SettlementReadContext,
    input: ListPreviewsInput,
  ): Promise<PreviewAnchor | null> {
    if (input.cursor === null) {
      return null;
    }
    const previewId = decodePreviewCursor(input.cursor);
    const anchor = await ctx.settlements.findPreviewAnchor(
      input.tripId,
      input.userId,
      previewId,
    );
    if (anchor === null) {
      throw invalidPreviewCursor();
    }
    return anchor;
  }
}
