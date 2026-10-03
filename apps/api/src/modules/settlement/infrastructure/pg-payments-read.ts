import { asc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  paymentCancellations,
  payments,
} from "../../../infrastructure/database/schema/record";
import type {
  Payment,
  PaymentCancellation,
} from "../../record/domain/payment";
import {
  toPaymentCancellationDomain,
  toPaymentDomain,
} from "../../record/infrastructure/drizzle-payment.repository";
import type { PaymentsReadPort } from "../adapter/outbound/payments-read.port";

/**
 * record の支払いの読み取り（settlement から port 越しに使う）。
 * UoW のトランザクション内の db ハンドルを受けて使う。
 */
export class PgPaymentsRead implements PaymentsReadPort {
  constructor(private readonly db: NodePgDatabase) {}

  /** 支払いを記録順（created_at, id の昇順）で返す。 */
  async listInTrip(tripId: string): Promise<readonly Payment[]> {
    const rows = await this.db
      .select()
      .from(payments)
      .where(eq(payments.tripId, tripId))
      .orderBy(asc(payments.createdAt), asc(payments.id));
    return rows.map(toPaymentDomain);
  }

  async listCancellationsInTrip(
    tripId: string,
  ): Promise<readonly PaymentCancellation[]> {
    const rows = await this.db
      .select()
      .from(paymentCancellations)
      .where(eq(paymentCancellations.tripId, tripId));
    return rows.map(toPaymentCancellationDomain);
  }
}
