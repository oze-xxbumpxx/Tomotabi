import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { BoundedText } from "../../../common/domain/bounded-text";
import type { ParticipantSlot } from "../../../common/domain/participant-slot";
import { UserId } from "../../../common/domain/user-id";
import type { PaymentYen, SignedYen } from "../../../common/domain/yen";
import {
  paymentCancellations,
  payments,
} from "../../../infrastructure/database/schema/record";
import type { PaymentRepository } from "../adapter/outbound/payment.repository";
import type {
  NewPayment,
  NewPaymentCancellation,
  Payment,
  PaymentCancellation,
} from "../domain/payment";

type PaymentRow = typeof payments.$inferSelect;
type PaymentCancellationRow = typeof paymentCancellations.$inferSelect;

export function toPaymentDomain(row: PaymentRow): Payment {
  return {
    id: row.id,
    tripId: row.tripId,
    planId: row.planId,
    amount: row.amountYen as PaymentYen,
    payerSlot: row.payerSlot as ParticipantSlot,
    slot0Percent: row.slot0Percent,
    slot0Burden: row.slot0BurdenYen as SignedYen,
    slot1Burden: row.slot1BurdenYen as SignedYen,
    contribution: row.contributionYen as SignedYen,
    label: row.label as BoundedText | null,
    createdBy: UserId.parse(row.createdBy),
    createdAt: row.createdAt,
  };
}

export function toPaymentCancellationDomain(
  row: PaymentCancellationRow,
): PaymentCancellation {
  return {
    paymentId: row.paymentId,
    tripId: row.tripId,
    cancelledBy: UserId.parse(row.cancelledBy),
    createdAt: row.createdAt,
  };
}

/**
 * record.payments・record.payment_cancellationsへの追記と照会。
 * 更新・削除はしない（追記のみの履歴表。BEFORE UPDATE OR DELETEトリガー）。
 * UoWのトランザクション内のdbハンドルを受けて使う。
 */
export class DrizzlePaymentRepository implements PaymentRepository {
  constructor(private readonly db: NodePgDatabase) {}

  async insert(payment: NewPayment): Promise<Payment> {
    const rows = await this.db
      .insert(payments)
      .values({
        tripId: payment.tripId,
        planId: payment.planId,
        amountYen: payment.amount,
        payerSlot: payment.payerSlot,
        slot0Percent: payment.slot0Percent,
        slot0BurdenYen: payment.slot0Burden,
        slot1BurdenYen: payment.slot1Burden,
        contributionYen: payment.contribution,
        label: payment.label,
        createdBy: payment.createdBy,
      })
      .returning();
    return toPaymentDomain(rows[0]!);
  }

  async findInTrip(tripId: string, paymentId: string): Promise<Payment | null> {
    const rows = await this.db
      .select()
      .from(payments)
      .where(and(eq(payments.tripId, tripId), eq(payments.id, paymentId)));
    const row = rows[0];
    return row === undefined ? null : toPaymentDomain(row);
  }

  async findCancellationInTrip(
    tripId: string,
    paymentId: string,
  ): Promise<PaymentCancellation | null> {
    const rows = await this.db
      .select()
      .from(paymentCancellations)
      .where(
        and(
          eq(paymentCancellations.tripId, tripId),
          eq(paymentCancellations.paymentId, paymentId),
        ),
      );
    const row = rows[0];
    return row === undefined ? null : toPaymentCancellationDomain(row);
  }

  async insertCancellation(
    cancellation: NewPaymentCancellation,
  ): Promise<PaymentCancellation> {
    const rows = await this.db
      .insert(paymentCancellations)
      .values({
        paymentId: cancellation.paymentId,
        tripId: cancellation.tripId,
        cancelledBy: cancellation.cancelledBy,
      })
      .returning();
    return toPaymentCancellationDomain(rows[0]!);
  }
}
