import type { Records } from "@tomotabi/contracts";
import { ApiError } from "../../../common/http/api-error";
import { listRecordsQueryLimitDefault } from "../../../generated/planning.zod";
import { tripNotAccessible } from "../../planning/usecase/trip-write-flow";
import type {
  ListRecordsInput,
  ListRecordsInputPort,
} from "../adapter/inbound/list-records.input-port";
import type {
  RecordTimelineAnchor,
  RecordsReadContext,
  RecordsReadUnitOfWork,
} from "../adapter/outbound/records-read.port";
import {
  decodeRecordsCursor,
  encodeRecordsCursor,
  invalidRecordsCursor,
} from "./records-cursor";
import { joinTimelineItems } from "./records-dto";

function invalidRecordsQuery(): ApiError {
  return new ApiError({
    code: "INVALID_REQUEST",
    status: 400,
    message: "recordId requires type and cannot be used with cursor or limit",
  });
}

/**
 * 記録の一覧（F-20〜F-23）。支払い・達成・予約とそれぞれの取り消しを、
 * 登録日時の新しい順（同じ日時は種類・IDの順）に返す。
 * recordId指定時は元の記録とその取り消しの最大2件を返す（type必須、
 * cursor・limitと併用不可、該当なしは200の空配列・nextCursor=null）。
 */
export class ListRecordsUseCase implements ListRecordsInputPort {
  constructor(private readonly unitOfWork: RecordsReadUnitOfWork) {}

  async execute(input: ListRecordsInput): Promise<Records> {
    if (
      input.recordId !== null &&
      (input.type === null || input.cursor !== null || input.limit !== null)
    ) {
      throw invalidRecordsQuery();
    }
    return this.unitOfWork.run(async (ctx) => {
      const roster = await ctx.roster.find(input.tripId, input.userId);
      if (roster === null) {
        throw tripNotAccessible();
      }
      const after = await this.anchor(ctx, input);
      const page = await ctx.records.listTimeline(input.tripId, {
        type: input.type,
        planId: input.planId,
        recordId: input.recordId,
        after,
        // recordIdの表示は元の記録とその取り消しの最大2件。
        limit:
          input.recordId !== null
            ? 2
            : (input.limit ?? listRecordsQueryLimitDefault),
      });
      const eventIds = page.items
        .filter((row) => row.kind === "achievement" || row.kind === "booking")
        .map((row) => row.id);
      const paymentIds = page.items
        .filter((row) => row.kind === "payment")
        .map((row) => row.id);
      const [payments, paymentCancellations, planEventCancellations] =
        await Promise.all([
          ctx.records.listPaymentsByIds(input.tripId, paymentIds),
          ctx.records.listPaymentCancellationsByIds(input.tripId, paymentIds),
          ctx.records.listPlanEventCancellationsByIds(input.tripId, eventIds),
        ]);
      const items = joinTimelineItems({
        rows: page.items,
        roster,
        payments,
        paymentCancellations,
        planEventCancellations,
      });
      return {
        items: [...items],
        nextCursor:
          input.recordId !== null || page.nextAnchor === null
            ? null
            : encodeRecordsCursor({
                tripId: input.tripId,
                type: input.type,
                planId: input.planId,
                kind: page.nextAnchor.kind,
                id: page.nextAnchor.id,
              }),
      };
    });
  }

  /**
   * カーソルの起点をこの旅行の記録から引く。形が不正・起点が無い・
   * 別の旅行・別の絞り込みに紐付くカーソルは400（一覧の続きを
   * 偽造できない）。
   */
  private async anchor(
    ctx: RecordsReadContext,
    input: ListRecordsInput,
  ): Promise<RecordTimelineAnchor | null> {
    if (input.cursor === null) {
      return null;
    }
    const { kind, id } = decodeRecordsCursor(input.cursor, {
      tripId: input.tripId,
      type: input.type,
      planId: input.planId,
    });
    const anchor = await ctx.records.findAnchor(input.tripId, kind, id);
    if (anchor === null) {
      throw invalidRecordsCursor();
    }
    return anchor;
  }
}
