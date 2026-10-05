import { and, asc, eq, exists, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { ParticipantSlot } from "../../../common/domain/participant-slot";
import type { LocalDate } from "../../../common/domain/local-date";
import type { UserId } from "../../../common/domain/user-id";
import { users } from "../../../infrastructure/database/schema/identity";
import {
  plans,
  tripParticipants,
  trips,
} from "../../../infrastructure/database/schema/planning";
import type {
  HomeRosterEntry,
  HomeScheduleReadPort,
  HomeTripReadPort,
  HomeTripRow,
} from "../adapter/outbound/home-read.port";
import type { PlanView } from "../adapter/outbound/planning-read.port";
import { toTripDomain } from "./drizzle-trip.repository";
import { planViews } from "./pg-planning-read";

/**
 * ホームの読み取りのうちplanningが持つ部分（旅行＋参加者、対象日の
 * 予定）。UoWのトランザクション内のdbハンドルを受けて使う。
 * 旅行の読み取りは認可をSQLの条件で行い、参加していない・存在しない
 * 旅行はnullを返す（どちらも同じ扱い。存在を漏らさない）。
 */
export class PgHomeRead implements HomeTripReadPort, HomeScheduleReadPort {
  constructor(private readonly db: NodePgDatabase) {}

  async find(tripId: string, actorId: UserId): Promise<HomeTripRow | null> {
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
    const tripRows = await this.db
      .select()
      .from(trips)
      .where(and(eq(trips.id, tripId), participates));
    const tripRow = tripRows[0];
    if (tripRow === undefined) {
      return null;
    }
    const rosterRows = await this.db
      .select({
        slot: tripParticipants.slot,
        userId: tripParticipants.userId,
        displayName: users.name,
      })
      .from(tripParticipants)
      .innerJoin(users, eq(users.id, tripParticipants.userId))
      .where(eq(tripParticipants.tripId, tripId))
      .orderBy(asc(tripParticipants.slot));
    // 参加者の確認を同じトランザクションで通ったあとrosterが空なのは
    // データの不整合。漏らさないよう旅行なしと同じnullを返す。
    if (rosterRows.length === 0) {
      return null;
    }
    const roster: HomeRosterEntry[] = rosterRows.map((row) => ({
      slot: ParticipantSlot.parse(row.slot),
      userId: row.userId as UserId,
      displayName: row.displayName,
    }));
    return { trip: toTripDomain(tripRow), roster };
  }

  async listForDay(tripId: string, date: LocalDate): Promise<PlanView[]> {
    return planViews(
      this.db,
      and(eq(plans.tripId, tripId), eq(plans.plannedDate, date)),
      // 時刻の早い順・未定（NULL）は末尾（ASCの既定）・登録日時・id。
      asc(plans.plannedTime),
      asc(plans.createdAt),
      asc(plans.id),
    );
  }
}
