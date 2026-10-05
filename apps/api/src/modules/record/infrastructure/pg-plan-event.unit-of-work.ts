import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import type { UnitOfWork } from "../../../adapter/transaction/unit-of-work";
import type { UserId } from "../../../common/domain/user-id";
import { PgCommandReceipts } from "../../../infrastructure/database/pg-command-receipts";
import { DrizzleTripRepository } from "../../planning/infrastructure/drizzle-trip.repository";
import type { PlanEligibilityFactory } from "../adapter/outbound/plan-eligibility.port";
import type {
  PlanEventWorkContext,
  TripShareLockPort,
} from "../adapter/outbound/plan-event-work-context";
import { DrizzlePlanEventRepository } from "./drizzle-plan-event.repository";

class PgTripShareLock implements TripShareLockPort {
  constructor(private readonly db: NodePgDatabase) {}

  async lockForShare(
    tripId: string,
    actorId: UserId,
  ): Promise<Readonly<{ id: string }> | null> {
    const trip = await new DrizzleTripRepository(this.db).lockForShare(
      tripId,
      actorId,
    );
    return trip === null ? null : { id: trip.id };
  }
}

/**
 * 達成・予約の業務単位を1トランザクションに束ねる（設計書
 * 「UnitOfWorkの文脈」）。予定の書き込みと同じく、旅行行FOR SHARE →
 * 予定行FOR NO KEY UPDATEの順でロックする。お金の順番待ちの行は
 * 取らない（金銭の書き込みとロックの取り方を逆順にしないため）。
 */
export class PgPlanEventUnitOfWork implements UnitOfWork<PlanEventWorkContext> {
  constructor(
    private readonly pool: Pool,
    private readonly planEligibilityFactory: PlanEligibilityFactory,
  ) {}

  async run<T>(work: (ctx: PlanEventWorkContext) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let released = false;
    try {
      await client.query("BEGIN");
      const db = drizzle(client);
      const result = await work({
        trips: new PgTripShareLock(db),
        receipts: new PgCommandReceipts(db),
        planEligibility: this.planEligibilityFactory(db),
        planEvents: new DrizzlePlanEventRepository(db),
      });
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        // ROLLBACK自体が失敗した接続（切断など）は壊れているため、
        // プールに戻さず捨てる。
        client.release(
          rollbackError instanceof Error
            ? rollbackError
            : new Error("ROLLBACK に失敗しました", { cause: rollbackError }),
        );
        released = true;
        throw error;
      }
      throw error;
    } finally {
      if (!released) {
        client.release();
      }
    }
  }
}
