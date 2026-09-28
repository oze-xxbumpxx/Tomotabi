import { and, eq, gt, lt, or } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { BoundedText } from "../../../common/domain/bounded-text";
import { LocalDate } from "../../../common/domain/local-date";
import { LocalTime } from "../../../common/domain/local-time";
import { UserId } from "../../../common/domain/user-id";
import { plans } from "../../../infrastructure/database/schema/planning";
import type { Plan } from "../domain/plan";
import type { PlanKind } from "../domain/plan-kind";
import type { TripPeriod } from "../domain/trip-period";
import type { NewPlan, PlanRepository } from "../adapter/outbound/plan.repository";

type PlanRow = typeof plans.$inferSelect;

export function toPlanDomain(row: PlanRow): Plan {
  return {
    id: row.id,
    tripId: row.tripId,
    name: row.name as BoundedText,
    kind: row.kind as PlanKind,
    date: LocalDate.parse(row.plannedDate),
    // time(0) は DB から 'HH:mm:ss' で返る。ドメインの LocalTime は 'HH:mm'。
    time:
      row.plannedTime === null
        ? null
        : LocalTime.parse(row.plannedTime.slice(0, 5)),
    memo: row.memo as BoundedText | null,
    cancelledAt: row.cancelledAt,
    cancelledBy: row.cancelledBy === null ? null : UserId.parse(row.cancelledBy),
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * 取りやめ済みも含めるため、どの問い合わせも cancelled_at で絞り込まない。
 */
export class DrizzlePlanRepository implements PlanRepository {
  constructor(private readonly db: NodePgDatabase) {}

  async datesOutside(
    tripId: string,
    period: TripPeriod,
  ): Promise<LocalDate[]> {
    const rows = await this.db
      .select({ plannedDate: plans.plannedDate })
      .from(plans)
      .where(
        and(
          eq(plans.tripId, tripId),
          or(
            lt(plans.plannedDate, period.startsOn),
            gt(plans.plannedDate, period.endsOn),
          ),
        ),
      );
    return rows.map((row) => LocalDate.parse(row.plannedDate));
  }

  /**
   * FOR NO KEY UPDATE にする。FOR UPDATE はキー無し列だけの更新でも強すぎて、
   * M4 の達成・予約 INSERT が取る行ロック（FK の親行参照）と衝突しやすい。
   */
  async lockForUpdate(tripId: string, planId: string): Promise<Plan | null> {
    const rows = await this.db
      .select()
      .from(plans)
      .where(and(eq(plans.tripId, tripId), eq(plans.id, planId)))
      .for("no key update");
    return rows[0] === undefined ? null : toPlanDomain(rows[0]);
  }

  async insert(plan: NewPlan): Promise<Plan> {
    const rows = await this.db
      .insert(plans)
      .values({
        tripId: plan.tripId,
        name: plan.name,
        kind: plan.kind,
        plannedDate: plan.date,
        plannedTime: plan.time,
        memo: plan.memo,
      })
      .returning();
    return toPlanDomain(rows[0]!);
  }

  async update(plan: Plan): Promise<void> {
    await this.db
      .update(plans)
      .set({
        name: plan.name,
        kind: plan.kind,
        plannedDate: plan.date,
        plannedTime: plan.time,
        memo: plan.memo,
        cancelledAt: plan.cancelledAt,
        cancelledBy: plan.cancelledBy,
        version: plan.version,
        updatedAt: plan.updatedAt,
      })
      .where(eq(plans.id, plan.id));
  }
}
