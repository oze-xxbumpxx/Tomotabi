import type { Balance as BalanceContract } from "@tomotabi/contracts";
import type { Clock } from "../../../adapter/clock/clock";
import type { PaymentCancellation } from "../../record/domain/payment";
import { tripNotAccessible } from "../../planning/usecase/trip-write-flow";
import { balanceOf } from "../domain/balance";
import { deriveTargets } from "../domain/settlement-target";
import type {
  GetBalanceInput,
  GetBalanceInputPort,
} from "../adapter/inbound/get-balance.input-port";
import type { SettlementReadUnitOfWork } from "../adapter/outbound/settlement-work-context";
import {
  joinPreviewItems,
  toParticipantsDto,
  toTargetItemDto,
  toTransferDto,
} from "./settlement-dto";

/**
 * 残額の取得（F-10）。支払い・取り消し・占有をREPEATABLE READの
 * 1スナップショットから読み、対象の導出（F-11）と残額で組み立てる。
 */
export class GetBalanceUseCase implements GetBalanceInputPort {
  constructor(
    private readonly unitOfWork: SettlementReadUnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(input: GetBalanceInput): Promise<BalanceContract> {
    return this.unitOfWork.run(async (ctx) => {
      const roster = await ctx.roster.find(input.tripId, input.userId);
      if (roster === null) {
        throw tripNotAccessible();
      }
      const payments = await ctx.paymentsRead.listInTrip(input.tripId);
      const cancellations = await ctx.paymentsRead.listCancellationsInTrip(
        input.tripId,
      );
      const cancelledIds = new Set(
        cancellations.map((cancellation) => cancellation.paymentId),
      );
      const cancellationsById = new Map<string, PaymentCancellation>(
        cancellations.map((cancellation) => [
          cancellation.paymentId,
          cancellation,
        ]),
      );
      const claims = await ctx.settlements.listActiveClaims(input.tripId);
      const targets = deriveTargets(payments, cancelledIds, claims);
      const balance = balanceOf(targets);
      const paymentsById = new Map(payments.map((payment) => [payment.id, payment]));
      const items = joinPreviewItems(
        targets,
        paymentsById,
        cancellationsById,
      );
      return {
        tripId: input.tripId,
        participants: toParticipantsDto(roster),
        transfer: toTransferDto(balance.signedTotal, roster),
        targetCount: balance.targetCount,
        items: items.map((item) => toTargetItemDto(item, roster)),
        fetchedAt: this.clock.now().toISOString(),
      };
    });
  }
}
