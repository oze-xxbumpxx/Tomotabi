import type { BalanceSummary } from "@tomotabi/contracts";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { HomeRosterEntry } from "../../planning/adapter/outbound/home-read.port";
import type { HomeBalancePort } from "../../planning/adapter/outbound/home-balance.port";
import type { TripRosterEntry } from "../../record/adapter/outbound/finance-work-context";
import { balanceOf } from "../domain/balance";
import { deriveTargets } from "../domain/settlement-target";
import { toTransferDto } from "../usecase/settlement-dto";
import { DrizzleSettlementRepository } from "./drizzle-settlement.repository";
import { PgPaymentsRead } from "./pg-payments-read";

/**
 * ホームの「精算」の欄の照会。残額の取得（F-10）と同じ
 * 支払い・取り消し・占有の読み取りから対象の導出（F-11）と残額を
 * 組み立て、ホームが要る受け渡しの向き・金額と対象の件数だけ返す。
 * ホーム専用の金額の計算式は作らない（残額の計算をそのまま使う）。
 * UoWのトランザクション内のdbハンドルを受けて使う。
 */
export class PgHomeBalanceRead implements HomeBalancePort {
  private readonly paymentsRead: PgPaymentsRead;
  private readonly settlements: DrizzleSettlementRepository;

  constructor(db: NodePgDatabase) {
    this.paymentsRead = new PgPaymentsRead(db);
    this.settlements = new DrizzleSettlementRepository(db);
  }

  async findSummary(
    tripId: string,
    roster: readonly HomeRosterEntry[],
  ): Promise<BalanceSummary> {
    const payments = await this.paymentsRead.listInTrip(tripId);
    const cancellations =
      await this.paymentsRead.listCancellationsInTrip(tripId);
    const cancelledIds = new Set(
      cancellations.map((cancellation) => cancellation.paymentId),
    );
    const claims = await this.settlements.listActiveClaims(tripId);
    const targets = deriveTargets(payments, cancelledIds, claims);
    const balance = balanceOf(targets);
    const rosterForDto: TripRosterEntry[] = roster.map(
      (entry): TripRosterEntry => ({
        slot: entry.slot,
        userId: entry.userId,
        displayName: entry.displayName,
      }),
    );
    return {
      transfer: toTransferDto(balance.signedTotal, rosterForDto),
      targetCount: balance.targetCount,
    };
  }
}
