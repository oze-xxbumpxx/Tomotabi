import type { Settlement } from "@tomotabi/contracts";
import { ApiError } from "../../../common/http/api-error";
import { SignedYen } from "../../../common/domain/yen";
import type { WriteLog } from "../../planning/adapter/outbound/write-log.port";
import type { PaymentCancellation } from "../../record/domain/payment";
import {
  executeFinanceWrite,
  runFinanceWriteTransaction,
  type FinanceWritePersist,
} from "../../record/usecase/finance-write-flow";
import type { TripRosterEntry } from "../../record/adapter/outbound/finance-work-context";
import type { ClaimHistory } from "../domain/fingerprint";
import { validatePreview } from "../domain/preview-validation";
import type { ClaimKind } from "../domain/settlement-target";
import {
  COMPLETE_SETTLEMENT_OPERATION,
  type CompleteSettlementInput,
  type CompleteSettlementInputPort,
} from "../adapter/inbound/complete-settlement.input-port";
import type {
  NewSettlementItem,
  PreviewItemRecord,
  SettlementRecord,
} from "../adapter/outbound/settlement.repository";
import type {
  SettlementUnitOfWork,
  SettlementWorkContext,
} from "../adapter/outbound/settlement-work-context";
import { currentClaimStates } from "./current-claims";
import { joinPreviewItems, toSettlementDto } from "./settlement-dto";

export function previewNotFound(): ApiError {
  return new ApiError({
    code: "PREVIEW_NOT_FOUND",
    status: 404,
    message: "Preview not found",
  });
}

function previewItemKey(item: {
  paymentId: string;
  kind: ClaimKind;
}): string {
  return `${item.paymentId}|${item.kind}`;
}

/**
 * 完了の記録（F-24〜F-32、E-05〜E-08・E-10・E-13）。
 * お金の書き込みの共通の流れ（参加者の確認 → 札のロック → 受領 →
 * 検証 → 履歴と占有と受領を同じトランザクションで保存）に乗せる。
 *
 * 順序（設計書「完了」）:
 *   1. 確認が旅行に属するか → 無ければ 404
 *   2. 確認に精算があれば: 取り消し済み → 409（E-10。新しい確認へ）、
 *      有効 → 200 で既存の精算を返す（E-07。対象全体が同じ精算で
 *      処理されているときだけ既存を返せる）
 *   3. 確認の金額と完了の種類の対応（非 0 円は transfer_completed、
 *      0 円は no_transfer_required）→ 違えば 422
 *   4. 明細ごとの指紋・取り消し状態を今と比べる:
 *      - 一部だけ別の精算で占有 → 409 TARGET_PARTIALLY_SETTLED（E-08）
 *      - 全部が同じ 1 つの精算で同じ対象として占有 → 409
 *        TARGET_ALREADY_SETTLED（既存の精算を表示できる）
 *      - それ以外の指紋の違い → 409 PREVIEW_CHANGED（E-05）
 *      - BASE 対象だけが取り消されていて、了承の集合が今の取り消し
 *        済み BASE の集合と一致 → 許可（F-32）。違えば 409
 *        CANCELLED_ITEMS_ACK_REQUIRED（E-06）
 *   5. 連番を払い出し、精算・明細・占有・受領を保存
 */
export class CompleteSettlementUseCase implements CompleteSettlementInputPort {
  constructor(
    private readonly unitOfWork: SettlementUnitOfWork,
    private readonly writeLog: WriteLog,
  ) {}

  async execute(
    input: CompleteSettlementInput,
  ): Promise<{ httpStatus: 200 | 201; body: Settlement }> {
    return executeFinanceWrite(
      this.writeLog,
      COMPLETE_SETTLEMENT_OPERATION,
      input.tripId,
      input.previewId,
      () =>
        runFinanceWriteTransaction<Settlement, SettlementWorkContext>(
          this.unitOfWork,
          {
            userId: input.userId,
            tripId: input.tripId,
            operation: COMPLETE_SETTLEMENT_OPERATION,
            key: input.key,
            requestHash: input.requestHash,
          },
          (ctx, roster) => this.persist(ctx, roster, input),
        ),
    );
  }

  private async persist(
    ctx: SettlementWorkContext,
    roster: readonly TripRosterEntry[],
    input: CompleteSettlementInput,
  ): Promise<FinanceWritePersist<Settlement>> {
    const preview = await ctx.settlements.findPreviewInTrip(
      input.tripId,
      input.previewId,
    );
    if (preview === null) {
      throw previewNotFound();
    }
    if (
      new Set(input.acknowledgedCancellationPaymentIds).size !==
      input.acknowledgedCancellationPaymentIds.length
    ) {
      throw new ApiError({
        code: "INVALID_REQUEST",
        status: 400,
        message: "acknowledgedCancellationPaymentIds contains duplicates",
      });
    }
    const requiredKind =
      preview.signedTotal === SignedYen.ZERO
        ? "no_transfer_required"
        : "transfer_completed";
    if (input.completionKind !== requiredKind) {
      throw new ApiError({
        code: "VALIDATION_FAILED",
        status: 422,
        message: "completionKind does not match the preview total",
      });
    }

    const itemRows =
      (await ctx.settlements.listPreviewItems(input.tripId, [
        preview.id,
      ])).get(preview.id) ?? [];
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

    const existing = await ctx.settlements.findSettlementForPreview(
      input.tripId,
      preview.id,
    );
    if (existing !== null) {
      return this.existingSettlement(ctx, roster, input.tripId, existing);
    }

    const validation = validatePreview(
      itemRows,
      currentClaimStates(
        itemRows.map((item) => item.paymentId),
        histories,
        cancelledIds,
      ),
      null,
    );
    if (validation.status === "target_changed") {
      await this.rejectChangedTarget(ctx, input.tripId, itemRows, histories);
    }
    // existing が null のとき、already_completed / completed_then_cancelled
    // は起きない（validatePreview がその状態を返すのは精算があるときだけ）。
    const acknowledged = new Set(input.acknowledgedCancellationPaymentIds);
    if (
      validation.status === "cancelled_items_ack_required" ||
      acknowledged.size > 0
    ) {
      const requiredAcks = new Set(validation.cancelledPaymentIds);
      const matches =
        acknowledged.size === requiredAcks.size &&
        [...acknowledged].every((id) => requiredAcks.has(id));
      if (!matches) {
        throw new ApiError({
          code: "CANCELLED_ITEMS_ACK_REQUIRED",
          status: 409,
          message:
            "Cancelled target payments require acknowledgement",
        });
      }
    }

    const sequence = await ctx.financeGuard.issueNextSettlementSequence(
      input.tripId,
    );
    const settlement = await ctx.settlements.insertSettlement({
      tripId: input.tripId,
      previewId: preview.id,
      sequence,
      createdBy: input.userId,
      signedTotal: preview.signedTotal,
      completionKind: input.completionKind,
    });
    const items: NewSettlementItem[] = itemRows.map((item) => ({
      paymentId: item.paymentId,
      kind: item.kind,
      contribution: item.contribution,
      baseSettlementId: item.baseSettlementId,
    }));
    await ctx.settlements.insertSettlementItems(
      settlement.id,
      input.tripId,
      preview.id,
      items,
    );
    // 占有は明細と同じ (payment_id, kind) の行（active_claims の PK）。
    // 履歴と占有の更新は同じトランザクション（FD-11 から作り直せる補助状態）。
    await ctx.settlements.insertActiveClaims(input.tripId, settlement.id, items);

    const paymentsById = new Map(
      payments.map((payment) => [payment.id, payment]),
    );
    const cancellationsById = new Map<string, PaymentCancellation>(
      cancellations.map((cancellation) => [
        cancellation.paymentId,
        cancellation,
      ]),
    );
    const body = toSettlementDto(
      settlement,
      joinPreviewItems(itemRows, paymentsById, cancellationsById),
      null,
      // 完了したばかりの精算は、取り消されていない連番最大のもの
      { id: settlement.id, sequence: settlement.sequence },
      roster,
    );
    return {
      body,
      httpStatus: 201,
      resourceType: "settlement",
      resourceId: settlement.id,
    };
  }

  /**
   * 既存の精算があればその結果を返す。取り消し済みなら 409（E-10:
   * 新しい確認を作り直す案内）。
   */
  private async existingSettlement(
    ctx: SettlementWorkContext,
    roster: readonly TripRosterEntry[],
    tripId: string,
    existing: { id: string; cancelled: boolean },
  ): Promise<FinanceWritePersist<Settlement>> {
    if (existing.cancelled) {
      throw new ApiError({
        code: "PREVIEW_CHANGED",
        status: 409,
        message:
          "Preview was completed and then cancelled; create a new preview",
      });
    }
    const settlement = await ctx.settlements.findSettlementInTrip(
      tripId,
      existing.id,
    );
    if (settlement === null) {
      // 占有の表と精算の表の整合が壊れている。黙って続けない。
      throw new Error("existing settlement row is missing");
    }
    const body = await this.assembleSettlementDto(
      ctx,
      roster,
      tripId,
      settlement,
    );
    return {
      body,
      httpStatus: 200,
      resourceType: "settlement",
      resourceId: settlement.id,
    };
  }

  /**
   * target_changed の細分（E-05/E-08・設計書「明細ごとの比較」）。
   * 明細の占有の有無で分ける:
   *   - 一部だけ別の精算に占有 → TARGET_PARTIALLY_SETTLED
   *   - 全部が同じ 1 つの精算の、同じ対象として占有 → TARGET_ALREADY_SETTLED
   *   - それ以外 → PREVIEW_CHANGED
   */
  private async rejectChangedTarget(
    ctx: SettlementWorkContext,
    tripId: string,
    itemRows: readonly PreviewItemRecord[],
    histories: ReadonlyMap<string, ClaimHistory>,
  ): Promise<never> {
    const claimedBy = new Map<string, string>(); // paymentId|kind -> settlementId
    for (const item of itemRows) {
      const claim = histories.get(item.paymentId)?.activeClaims[item.kind];
      if (claim !== undefined) {
        claimedBy.set(previewItemKey(item), claim);
      }
    }
    if (claimedBy.size === 0) {
      throw new ApiError({
        code: "PREVIEW_CHANGED",
        status: 409,
        message: "Settlement targets changed since the preview",
      });
    }
    if (claimedBy.size < itemRows.length) {
      throw new ApiError({
        code: "TARGET_PARTIALLY_SETTLED",
        status: 409,
        message: "Some targets were settled by another settlement",
      });
    }
    const settlementIds = new Set(claimedBy.values());
    const singleSettlementId =
      settlementIds.size === 1 ? [...settlementIds][0] : undefined;
    if (singleSettlementId !== undefined) {
      const settledItems =
        (await ctx.settlements.listSettlementItems(tripId, [
          singleSettlementId,
        ])).get(singleSettlementId) ?? [];
      const settledKeys = new Set(
        settledItems.map((item) => previewItemKey(item)),
      );
      const sameTarget =
        settledKeys.size === itemRows.length &&
        itemRows.every((item) => settledKeys.has(previewItemKey(item)));
      if (sameTarget) {
        throw new ApiError({
          code: "TARGET_ALREADY_SETTLED",
          status: 409,
          message: "The same targets were already settled",
          details: { existingSettlementId: singleSettlementId },
        });
      }
    }
    throw new ApiError({
      code: "PREVIEW_CHANGED",
      status: 409,
      message: "Settlement targets changed since the preview",
    });
  }

  /** 精算の DTO を組み立てる（明細・取り消し・最新の有効な精算の照会）。 */
  private async assembleSettlementDto(
    ctx: SettlementWorkContext,
    roster: readonly TripRosterEntry[],
    tripId: string,
    settlement: SettlementRecord,
  ): Promise<Settlement> {
    const itemRows =
      (await ctx.settlements.listSettlementItems(tripId, [
        settlement.id,
      ])).get(settlement.id) ?? [];
    const payments = await ctx.paymentsRead.listInTrip(tripId);
    const cancellations = await ctx.paymentsRead.listCancellationsInTrip(
      tripId,
    );
    const latestActive = await ctx.settlements.findLatestActiveSettlement(
      tripId,
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
    return toSettlementDto(
      settlement,
      joinPreviewItems(itemRows, paymentsById, cancellationsById),
      null,
      latestActive,
      roster,
    );
  }
}
