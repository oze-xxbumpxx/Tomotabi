import type { SettlementPage } from "@tomotabi/contracts";
import type { PaymentCancellation } from "../../record/domain/payment";
import { tripNotAccessible } from "../../planning/usecase/trip-write-flow";
import type {
  ListSettlementsInput,
  ListSettlementsInputPort,
} from "../adapter/inbound/list-settlements.input-port";
import type { SettlementAnchor } from "../adapter/outbound/settlement.repository";
import type {
  SettlementReadContext,
  SettlementReadUnitOfWork,
} from "../adapter/outbound/settlement-work-context";
import {
  decodeSettlementCursor,
  encodeSettlementCursor,
  invalidSettlementCursor,
} from "./settlement-cursor";
import { joinPreviewItems, toSettlementDto } from "./settlement-dto";

/**
 * 精算の一覧（F-33）。旅行内連番の降順・取り消し済みを含む・20件ずつの
 * カーソル。各件に取り消し状態と取り消せるかを付ける（取り消せるのは
 * 最新の有効な精算だけ）。
 */
export class ListSettlementsUseCase implements ListSettlementsInputPort {
  constructor(private readonly unitOfWork: SettlementReadUnitOfWork) {}

  async execute(input: ListSettlementsInput): Promise<SettlementPage> {
    return this.unitOfWork.run(async (ctx) => {
      const roster = await ctx.roster.find(input.tripId, input.userId);
      if (roster === null) {
        throw tripNotAccessible();
      }
      const after = await this.anchor(ctx, input);
      const page = await ctx.settlements.listSettlements(
        input.tripId,
        after,
        input.limit,
      );
      const settlementIds = page.items.map((settlement) => settlement.id);
      const itemsBySettlement = await ctx.settlements.listSettlementItems(
        input.tripId,
        settlementIds,
      );
      const payments = await ctx.paymentsRead.listInTrip(input.tripId);
      const cancellations = await ctx.paymentsRead.listCancellationsInTrip(
        input.tripId,
      );
      const latestActive = await ctx.settlements.findLatestActiveSettlement(
        input.tripId,
      );
      const paymentsById = new Map(
        payments.map((payment) => [payment.id, payment]),
      );
      const cancellationsById = new Map<string, PaymentCancellation>(
        cancellations.map((cancellation) => [
          cancellation.paymentId,
          cancellation,
        ]),
      );
      const items = page.items.map((settlement) =>
        toSettlementDto(
          settlement,
          joinPreviewItems(
            itemsBySettlement.get(settlement.id) ?? [],
            paymentsById,
            cancellationsById,
          ),
          settlement.cancellation,
          latestActive,
          roster,
        ),
      );
      return {
        items,
        nextCursor:
          page.nextCursorId === null
            ? null
            : encodeSettlementCursor(page.nextCursorId),
      };
    });
  }

  /**
   * カーソルの起点をこの旅行の精算から引く。形が不正・起点が無い・
   * 別の旅行の精算を指すカーソルは400（一覧の続きを偽造できない）。
   */
  private async anchor(
    ctx: SettlementReadContext,
    input: ListSettlementsInput,
  ): Promise<SettlementAnchor | null> {
    if (input.cursor === null) {
      return null;
    }
    const settlementId = decodeSettlementCursor(input.cursor);
    const anchor = await ctx.settlements.findSettlementAnchor(
      input.tripId,
      settlementId,
    );
    if (anchor === null) {
      throw invalidSettlementCursor();
    }
    return anchor;
  }
}
