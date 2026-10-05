import { and, asc, desc, eq, exists, sql, type SQL } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { alias } from "drizzle-orm/pg-core";
import type { Pool } from "pg";
import type { EventKind } from "@tomotabi/contracts";
import { UserId } from "../../../common/domain/user-id";
import type { LocalDate } from "../../../common/domain/local-date";
import {
  plans,
  tripParticipants,
  trips,
} from "../../../infrastructure/database/schema/planning";
import {
  activePlanEvents,
  planEvents,
} from "../../../infrastructure/database/schema/record";
import type { Trip } from "../domain/trip";
import type {
  PlanningReadPort,
  PlanView,
  TripListAnchor,
  TripListPage,
  TripListQuery,
} from "../adapter/outbound/planning-read.port";
import type { ActivePlanEvent } from "../adapter/outbound/record-history.port";
import { toPlanDomain } from "./drizzle-plan.repository";
import { toTripDomain } from "./drizzle-trip.repository";

type PlanEventRow = typeof planEvents.$inferSelect;

/**
 * LEFT JOINで取れなかった側は各列がnullで返る。idがnullなら行なし。
 */
type JoinedEventRow = {
  [K in keyof PlanEventRow]: PlanEventRow[K] | null;
} | null;

function toActivePlanEvent(row: JoinedEventRow): ActivePlanEvent | null {
  if (row === null || row.id === null) {
    return null;
  }
  const event = row as PlanEventRow;
  return {
    id: event.id,
    tripId: event.tripId,
    planId: event.planId,
    kind: event.eventKind as EventKind,
    createdBy: UserId.parse(event.createdBy),
    createdAt: event.createdAt,
  };
}

/**
 * 予定と、有効な達成・予約（active_plan_events経由）・履歴の有無を
 * 1回の読み取りで取る。取り消し済みはactiveに行が無いのでnullに
 * なるが、hasRecordHistoryはplan_eventsの存在で別に立てる。
 * ホームの読み取り（pg-home-read.ts）がtxのdbハンドルで使い回すため
 * 関数として切り出してある。
 */
export async function planViews(
  db: NodePgDatabase,
  where: SQL | undefined,
  ...orderBy: SQL[]
): Promise<PlanView[]> {
  const activeAchievement = alias(activePlanEvents, "active_achievement");
  const achievementEvent = alias(planEvents, "achievement_event");
  const activeBooking = alias(activePlanEvents, "active_booking");
  const bookingEvent = alias(planEvents, "booking_event");
  const rows = await db
    .select({
      plan: plans,
      achievementEvent,
      bookingEvent,
      hasRecordHistory: exists(
        db
          .select({ _: sql`1` })
          .from(planEvents)
          .where(eq(planEvents.planId, plans.id)),
      ),
    })
    .from(plans)
    .leftJoin(
      activeAchievement,
      and(
        eq(activeAchievement.planId, plans.id),
        eq(activeAchievement.eventKind, "achievement"),
      ),
    )
    .leftJoin(
      achievementEvent,
      eq(achievementEvent.id, activeAchievement.eventId),
    )
    .leftJoin(
      activeBooking,
      and(
        eq(activeBooking.planId, plans.id),
        eq(activeBooking.eventKind, "booking"),
      ),
    )
    .leftJoin(bookingEvent, eq(bookingEvent.id, activeBooking.eventId))
    .where(where)
    .orderBy(...orderBy);
  return rows.map((row) => ({
    plan: toPlanDomain(row.plan),
    achievement: toActivePlanEvent(row.achievementEvent),
    booking: toActivePlanEvent(row.bookingEvent),
    hasRecordHistory: row.hasRecordHistory as boolean,
  }));
}

/**
 * 一覧・取得の読み取り。トランザクション・行ロックは使わず、
 * プールの接続から直接読む（書き込みの整合はUoW側が持つ）。
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
    // created_atをtextで取る。Date（ミリ秒）に変換すると同じミリ秒内の
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
      // (created_at, id)の複合キーで「より古い側」のページを取る。
      // createdAtはfindTripAnchorが ::textで取ったDBの値なので
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

  async findPlanInTrip(
    tripId: string,
    planId: string,
  ): Promise<PlanView | null> {
    const rows = await planViews(this.db, and(eq(plans.tripId, tripId), eq(plans.id, planId)));
    return rows[0] === undefined ? null : rows[0];
  }

  async listPlansForDay(
    tripId: string,
    date: LocalDate,
  ): Promise<PlanView[]> {
    return planViews(
      this.db,
      and(eq(plans.tripId, tripId), eq(plans.plannedDate, date)),
      // 時刻の早い順・未定（NULL）は末尾（ASCの既定）・登録日時・id。
      asc(plans.plannedTime),
      asc(plans.createdAt),
      asc(plans.id),
    );
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
