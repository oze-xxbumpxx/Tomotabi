import type {
  Cancellation,
  Payment as PaymentContract,
} from "@tomotabi/contracts";
import type { ParticipantSlot } from "../../../common/domain/participant-slot";
import type { UserId } from "../../../common/domain/user-id";
import { PaymentYen, SignedYen } from "../../../common/domain/yen";
import type { TripRosterEntry } from "../adapter/outbound/finance-work-context";
import type { Payment, PaymentCancellation } from "../domain/payment";

export function toCancellationDto(
  cancellation: PaymentCancellation,
): Cancellation {
  return {
    targetId: cancellation.paymentId,
    cancelledBy: cancellation.cancelledBy,
    createdAt: cancellation.createdAt.toISOString(),
  };
}

function userOf(
  roster: readonly TripRosterEntry[],
  slot: ParticipantSlot,
): UserId {
  const entry = roster.find((candidate) => candidate.slot === slot);
  if (entry === undefined) {
    // 支払いは参加者二人の旅行にしか記録できず、(trip_id, slot)のFKも
    // あるため、保存済みの支払いでここには来ない（来たらデータの不整合）。
    throw new Error(`Trip roster is missing participant slot ${slot}`);
  }
  return entry.userId;
}

/**
 * Domainの支払いを公開契約の形にする。負担額・寄与は保存時に確定した値。
 * allocationsは参加者番号0, 1の順（もう一人のpercentは100から引く）。
 */
export function toPaymentDto(
  payment: Payment,
  roster: readonly TripRosterEntry[],
  cancellation: PaymentCancellation | null,
): PaymentContract {
  return {
    id: payment.id,
    tripId: payment.tripId,
    planId: payment.planId,
    label: payment.label,
    amountYen: PaymentYen.toDecimalString(payment.amount),
    payerUserId: userOf(roster, payment.payerSlot),
    allocations: [
      {
        userId: userOf(roster, 0),
        percent: payment.slot0Percent,
        burdenYen: SignedYen.toDecimalString(payment.slot0Burden),
      },
      {
        userId: userOf(roster, 1),
        percent: 100 - payment.slot0Percent,
        burdenYen: SignedYen.toDecimalString(payment.slot1Burden),
      },
    ],
    createdBy: payment.createdBy,
    createdAt: payment.createdAt.toISOString(),
    cancellation:
      cancellation === null ? null : toCancellationDto(cancellation),
  };
}
