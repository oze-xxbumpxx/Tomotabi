import type { Preview } from "@tomotabi/contracts";
import { ApiError } from "../../../common/http/api-error";
import { SignedYen } from "../../../common/domain/yen";
import type { WriteLog } from "../../planning/adapter/outbound/write-log.port";
import {
  executeFinanceWrite,
  runFinanceWriteTransaction,
  type FinanceWritePersist,
} from "../../record/usecase/finance-write-flow";
import type { TripRosterEntry } from "../../record/adapter/outbound/finance-work-context";
import {
  EMPTY_CLAIM_HISTORY,
  fingerprintOf,
} from "../domain/fingerprint";
import { deriveTargets } from "../domain/settlement-target";
import {
  CREATE_PREVIEW_OPERATION,
  type CreatePreviewInput,
  type CreatePreviewInputPort,
} from "../adapter/inbound/create-preview.input-port";
import type {
  NewPreviewItem,
  PreviewRecord,
} from "../adapter/outbound/settlement.repository";
import type {
  SettlementUnitOfWork,
  SettlementWorkContext,
} from "../adapter/outbound/settlement-work-context";
import { joinPreviewItems, toPreviewDto } from "./settlement-dto";

/**
 * 確認の作成（F-20）。お金の書き込みの共通の流れ（参加者の確認 →
 * 札のロック → 受領 → 対象の読み取り → 保存）で、確認と明細を同じ
 * トランザクションで保存する。明細にはその時点の指紋と支払いの
 * 取り消し状態を入れる（あとで対象が変わったか・支払いが取り消されたかを
 * 明細と比べられるように）。
 */
export class CreatePreviewUseCase implements CreatePreviewInputPort {
  constructor(
    private readonly unitOfWork: SettlementUnitOfWork,
    private readonly writeLog: WriteLog,
  ) {}

  async execute(
    input: CreatePreviewInput,
  ): Promise<{ httpStatus: 200 | 201; body: Preview }> {
    return executeFinanceWrite(
      this.writeLog,
      CREATE_PREVIEW_OPERATION,
      input.tripId,
      null,
      () =>
        runFinanceWriteTransaction<Preview, SettlementWorkContext>(
          this.unitOfWork,
          {
            userId: input.userId,
            tripId: input.tripId,
            operation: CREATE_PREVIEW_OPERATION,
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
    input: CreatePreviewInput,
  ): Promise<FinanceWritePersist<Preview>> {
    const payments = await ctx.paymentsRead.listInTrip(input.tripId);
    const cancellations = await ctx.paymentsRead.listCancellationsInTrip(
      input.tripId,
    );
    const cancelledIds = new Set(
      cancellations.map((cancellation) => cancellation.paymentId),
    );
    const claims = await ctx.settlements.listActiveClaims(input.tripId);
    const targets = deriveTargets(payments, cancelledIds, claims);
    if (targets.length === 0) {
      // 対象0件では作れない（合計0円の確認は作れる。F-12・E-04）
      throw new ApiError({
        code: "NO_SETTLEMENT_TARGET",
        status: 422,
        message: "There is no settlement target",
      });
    }
    const histories = await ctx.settlements.claimHistories(
      input.tripId,
      targets.map((target) => target.paymentId),
    );
    const items: NewPreviewItem[] = targets.map((target) => ({
      paymentId: target.paymentId,
      kind: target.kind,
      contribution: target.contribution,
      baseSettlementId: target.baseSettlementId,
      expectedFingerprint: fingerprintOf(
        histories.get(target.paymentId) ?? EMPTY_CLAIM_HISTORY,
      ),
      expectedCancelled: cancelledIds.has(target.paymentId),
    }));
    let signedTotal = SignedYen.ZERO;
    for (const item of items) {
      signedTotal = SignedYen.add(signedTotal, item.contribution);
    }
    const preview: PreviewRecord = await ctx.settlements.insertPreview({
      tripId: input.tripId,
      createdBy: input.userId,
      signedTotal,
    });
    await ctx.settlements.insertPreviewItems(preview.id, input.tripId, items);

    const paymentsById = new Map(
      payments.map((payment) => [payment.id, payment]),
    );
    const cancellationsById = new Map(
      cancellations.map((cancellation) => [
        cancellation.paymentId,
        cancellation,
      ]),
    );
    const body = toPreviewDto(
      preview,
      joinPreviewItems(items, paymentsById, cancellationsById),
      roster,
      // 作った時点では指紋・取り消し状態が明細と一致するのでready
      {
        status: "ready",
        cancelledPaymentIds: [],
        changedPaymentIds: [],
        existingSettlementId: null,
      },
    );
    return {
      body,
      httpStatus: 201,
      resourceType: "preview",
      resourceId: preview.id,
    };
  }
}
