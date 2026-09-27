import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import type { UnitOfWork } from "../../../adapter/transaction/unit-of-work";
import { PgCommandReceipts } from "../../../infrastructure/database/pg-command-receipts";
import { tripFinanceGuards } from "../../../infrastructure/database/schema/infra";
import type { ParticipantsFactory } from "../adapter/outbound/participants.port";
import type {
  FinanceGuardWriter,
  PlanningWorkContext,
} from "../adapter/outbound/planning-work-context";
import { DrizzlePlanRepository } from "./drizzle-plan.repository";
import { DrizzleTripRepository } from "./drizzle-trip.repository";

class PgFinanceGuards implements FinanceGuardWriter {
  constructor(private readonly db: NodePgDatabase) {}

  async create(tripId: string): Promise<void> {
    await this.db.insert(tripFinanceGuards).values({ tripId });
  }
}

/**
 * planning の業務単位を 1 トランザクションに束ねる（設計書「UnitOfWork の文脈」）。
 * 文脈には型付きの Repository・照会・receipt の限定集合だけを渡し、
 * 生の接続は渡さない。
 */
export class PgPlanningUnitOfWork implements UnitOfWork<PlanningWorkContext> {
  constructor(
    private readonly pool: Pool,
    private readonly participantsFactory: ParticipantsFactory,
  ) {}

  async run<T>(work: (ctx: PlanningWorkContext) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const db = drizzle(client);
      const result = await work({
        trips: new DrizzleTripRepository(db),
        plans: new DrizzlePlanRepository(db),
        participants: this.participantsFactory(db),
        receipts: new PgCommandReceipts(db),
        financeGuards: new PgFinanceGuards(db),
      });
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
