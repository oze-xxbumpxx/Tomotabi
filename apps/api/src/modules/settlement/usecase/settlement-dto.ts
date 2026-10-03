import type {
  Participant,
  Preview as PreviewContract,
  PreviewSummary,
  PreviewValidation,
  TargetItem,
  Transfer,
} from "@tomotabi/contracts";
import type { ParticipantSlot } from "../../../common/domain/participant-slot";
import { SignedYen } from "../../../common/domain/yen";
import type { TripRosterEntry } from "../../record/adapter/outbound/finance-work-context";
import { transferOf } from "../domain/balance";
import type {
  Payment,
  PaymentCancellation,
} from "../../record/domain/payment";
import { toPaymentDto } from "../../record/usecase/payment-dto";
import type { ClaimKind } from "../domain/settlement-target";
import type { PreviewRecord } from "../adapter/outbound/settlement.repository";

function userOf(
  roster: readonly TripRosterEntry[],
  slot: ParticipantSlot,
): string {
  const entry = roster.find((candidate) => candidate.slot === slot);
  if (entry === undefined) {
    // 財務の旅行の参加者は必ず 2 人（FK と作成時の規則）。ここに来るのは
    // データの不整合。
    throw new Error(`Trip roster is missing participant slot ${slot}`);
  }
  return entry.userId;
}

/**
 * roster を参加者番号順の二人組にする。roster.find は参加者番号順に
 * 返す約束。二人組でないのはデータの不整合。
 */
export function toParticipantsDto(
  roster: readonly TripRosterEntry[],
): [Participant, Participant] {
  const first = roster.find((entry) => entry.slot === 0);
  const second = roster.find((entry) => entry.slot === 1);
  if (first === undefined || second === undefined || roster.length !== 2) {
    throw new Error("Trip roster must contain exactly participants 0 and 1");
  }
  return [
    {
      userId: first.userId,
      slot: 0,
      displayName: first.displayName,
    },
    {
      userId: second.userId,
      slot: 1,
      displayName: second.displayName,
    },
  ];
}

/**
 * 寄与の合計（参加者番号 1 の人から 0 の人への向きを正）から
 * 受け渡しの向き・金額を組み立てる。0 円なら from/to は null。
 */
export function toTransferDto(
  signedTotal: SignedYen,
  roster: readonly TripRosterEntry[],
): Transfer {
  const direction = transferOf(signedTotal);
  return {
    signedTotalYen: SignedYen.toDecimalString(direction.signedTotal),
    amountYen: SignedYen.toDecimalString(direction.amount),
    fromUserId:
      direction.fromSlot === null
        ? null
        : userOf(roster, direction.fromSlot),
    toUserId:
      direction.toSlot === null ? null : userOf(roster, direction.toSlot),
    requiresTransfer: direction.signedTotal !== 0n,
  };
}

export type TargetItemJoined = Readonly<{
  payment: Payment;
  cancellation: PaymentCancellation | null;
  kind: ClaimKind;
  contribution: SignedYen;
  baseSettlementId: string | null;
}>;

export function toTargetItemDto(
  item: TargetItemJoined,
  roster: readonly TripRosterEntry[],
): TargetItem {
  return {
    payment: toPaymentDto(item.payment, roster, item.cancellation),
    kind: item.kind,
    signedContributionYen: SignedYen.toDecimalString(item.contribution),
    baseSettlementId: item.baseSettlementId,
  };
}

export function toPreviewDto(
  preview: PreviewRecord,
  items: readonly TargetItemJoined[],
  roster: readonly TripRosterEntry[],
  validation: PreviewValidation,
): PreviewContract {
  return {
    id: preview.id,
    tripId: preview.tripId,
    createdBy: preview.createdBy,
    createdAt: preview.createdAt.toISOString(),
    participants: toParticipantsDto(roster),
    transfer: toTransferDto(preview.signedTotal, roster),
    items: items.map((item) => toTargetItemDto(item, roster)),
    validation,
  };
}

export function toPreviewSummaryDto(
  preview: PreviewRecord,
  targetCount: number,
  roster: readonly TripRosterEntry[],
  validation: PreviewValidation,
): PreviewSummary {
  return {
    id: preview.id,
    createdAt: preview.createdAt.toISOString(),
    transfer: toTransferDto(preview.signedTotal, roster),
    targetCount,
    validation,
  };
}

/** 対象の導出・明細の行に共通の、DTO 化に必要な最小の形。 */
export type ItemCore = Readonly<{
  paymentId: string;
  kind: ClaimKind;
  contribution: SignedYen;
  baseSettlementId: string | null;
}>;

/** 明細の行と支払い・取り消しをつなぐための照合。 */
export function joinPreviewItems(
  items: readonly ItemCore[],
  paymentsById: ReadonlyMap<string, Payment>,
  cancellationsById: ReadonlyMap<string, PaymentCancellation>,
): TargetItemJoined[] {
  return items.map((item) => {
    const payment = paymentsById.get(item.paymentId);
    if (payment === undefined) {
      // preview_items は payments への FK があり支払いは消えない。
      throw new Error("preview item references a missing payment");
    }
    return {
      payment,
      cancellation: cancellationsById.get(item.paymentId) ?? null,
      kind: item.kind,
      contribution: item.contribution,
      baseSettlementId: item.baseSettlementId,
    };
  });
}
