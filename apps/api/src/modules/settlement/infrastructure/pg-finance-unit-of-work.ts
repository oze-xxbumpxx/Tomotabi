import { and, asc, eq, exists, sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import type { UnitOfWork } from "../../../adapter/transaction/unit-of-work";
import { ParticipantSlot } from "../../../common/domain/participant-slot";
import type { UserId } from "../../../common/domain/user-id";
import { PgCommandReceipts } from "../../../infrastructure/database/pg-command-receipts";
import { tripFinanceGuards } from "../../../infrastructure/database/schema/infra";
import {
  plans,
  tripParticipants,
} from "../../../infrastructure/database/schema/planning";
import type {
  FinanceGuardLocker,
  FinanceWorkContext,
  TripPlansPort,
  TripRosterEntry,
  TripRosterPort,
} from "../../record/adapter/outbound/finance-work-context";
import { DrizzlePaymentRepository } from "../../record/infrastructure/drizzle-payment.repository";

/**
 * 旅行の参加者の照会。認可は SQL の条件で行う: actor が旅行の参加者
 * でなければ roster を返さない（EXISTS 副問い合わせ。設計書「認可は
 * SQL の条件」）。
 */
class PgTripRosterQuery implements TripRosterPort {
  constructor(private readonly db: NodePgDatabase) {}

  async find(
    tripId: string,
    actorId: UserId,
  ): Promise<readonly TripRosterEntry[] | null> {
    const participates = exists(
      this.db
        .select({ _: sql`1` })
        .from(tripParticipants)
        .where(
          and(
            eq(tripParticipants.tripId, tripId),
            eq(tripParticipants.userId, actorId),
          ),
        ),
    );
    const rows = await this.db
      .select({
        slot: tripParticipants.slot,
        userId: tripParticipants.userId,
      })
      .from(tripParticipants)
      .where(and(eq(tripParticipants.tripId, tripId), participates))
      .orderBy(asc(tripParticipants.slot));
    if (rows.length === 0) {
      return null;
    }
    return rows.map((row) => ({
      slot: ParticipantSlot.parse(row.slot),
      userId: row.userId as UserId,
    }));
  }
}

/**
 * infra.trip_finance_guards の行ロック。旅行作成時に guard の行は作られて
 * いるので、参加者の確認を通った旅行で行が無いのはデータの不整合。
 * FOR UPDATE の行ロックには UPDATE 権限が要るため、app_runtime には
 * next_settlement_sequence の列だけ UPDATE を付けてある（migration 0007）。
 */
class PgFinanceGuardLock implements FinanceGuardLocker {
  constructor(private readonly db: NodePgDatabase) {}

  async lock(tripId: string): Promise<void> {
    const rows = await this.db
      .select({ tripId: tripFinanceGuards.tripId })
      .from(tripFinanceGuards)
      .where(eq(tripFinanceGuards.tripId, tripId))
      .for("update");
    if (rows.length === 0) {
      throw new Error("trip_finance_guards row is missing for a joined trip");
    }
  }
}

/** 同じ旅行の予定かの照会（関連する予定の所属の検証）。 */
class PgTripPlansQuery implements TripPlansPort {
  constructor(private readonly db: NodePgDatabase) {}

  async existsInTrip(tripId: string, planId: string): Promise<boolean> {
    const rows = await this.db
      .select({ _: sql`1` })
      .from(plans)
      .where(and(eq(plans.tripId, tripId), eq(plans.id, planId)))
      .limit(1);
    return rows.length > 0;
  }
}

/**
 * お金の書き込みを 1 トランザクションに束ねる（設計書「UnitOfWork の文脈」）。
 * トランザクションの始めに lock_timeout を 3 秒にする（E-14: 待ちきれない・
 * デッドロックは巻き戻して 503。UseCase では再試行しない）。
 * 文脈には型付きの Repository・照会・receipt の限定集合だけを渡し、
 * 生の接続は渡さない。
 */
export class PgFinanceUnitOfWork implements UnitOfWork<FinanceWorkContext> {
  constructor(private readonly pool: Pool) {}

  async run<T>(work: (ctx: FinanceWorkContext) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL lock_timeout = '3s'");
      const db = drizzle(client);
      const result = await work({
        roster: new PgTripRosterQuery(db),
        financeGuard: new PgFinanceGuardLock(db),
        receipts: new PgCommandReceipts(db),
        payments: new DrizzlePaymentRepository(db),
        plans: new PgTripPlansQuery(db),
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
