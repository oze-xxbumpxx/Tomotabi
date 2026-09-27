import { and, desc, eq, exists, sql, type SQL } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import type { UserId } from "../../../common/domain/user-id";
import {
  tripParticipants,
  trips,
} from "../../../infrastructure/database/schema/planning";
import type { Trip } from "../domain/trip";
import type {
  PlanningReadPort,
  TripListAnchor,
  TripListPage,
  TripListQuery,
} from "../adapter/outbound/planning-read.port";
import { toTripDomain } from "./drizzle-trip.repository";

/**
 * 一覧・取得の読み取り。トランザクション・行ロックは使わず、
 * プールの接続から直接読む（書き込みの整合は UoW 側が持つ）。
 */
export class PgPlanningRead implements PlanningReadPort {
  private readonly db: NodePgDatabase;

  constructor(pool: Pool) {
    this.db = drizzle(pool);
  }

  async findTripForParticipant(
    tripId: string,
    userId: UserId,
  ): Promise<Trip | null> {
    const rows = await this.db
      .select()
      .from(trips)
      .where(and(eq(trips.id, tripId), this.participates(userId)));
    return rows[0] === undefined ? null : toTripDomain(rows[0]);
  }

  async findTripAnchor(
    tripId: string,
    userId: UserId,
  ): Promise<TripListAnchor | null> {
    // created_at を text で取る。Date（ミリ秒）に変換すると同じミリ秒内の
    // 違う行を区別できず、ページの境目で旅行が抜け落ちる。
    const rows = await this.db
      .select({ createdAt: sql<string>`${trips.createdAt}::text` })
      .from(trips)
      .where(and(eq(trips.id, tripId), this.participates(userId)));
    const row = rows[0];
    return row === undefined ? null : { createdAt: row.createdAt, id: tripId };
  }

  async listTripsForParticipant(
    userId: UserId,
    query: TripListQuery,
  ): Promise<TripListPage> {
    const conditions: SQL[] = [eq(tripParticipants.userId, userId)];
    if (query.status !== null) {
      conditions.push(eq(trips.status, query.status));
    }
    if (query.after !== null) {
      // (created_at, id) の複合キーで「より古い側」のページを取る。
      // createdAt は findTripAnchor が ::text で取った DB の値なので
      // マイクロ秒の精度が保たれる。
      conditions.push(
        sql`(${trips.createdAt}, ${trips.id}) < (${query.after.createdAt}::timestamptz, ${query.after.id}::uuid)`,
      );
    }
    const rows = await this.db
      .select({ trip: trips })
      .from(trips)
      .innerJoin(
        tripParticipants,
        eq(tripParticipants.tripId, trips.id),
      )
      .where(and(...conditions))
      .orderBy(desc(trips.createdAt), desc(trips.id))
      .limit(query.limit + 1);
    const items = rows
      .slice(0, query.limit)
      .map((row) => toTripDomain(row.trip));
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        rows.length > query.limit && last !== undefined
          ? { id: last.id }
          : null,
    };
  }

  private participates(userId: UserId) {
    return exists(
      this.db
        .select({ _: sql`1` })
        .from(tripParticipants)
        .where(
          and(
            eq(tripParticipants.tripId, trips.id),
            eq(tripParticipants.userId, userId),
          ),
        ),
    );
  }
}
