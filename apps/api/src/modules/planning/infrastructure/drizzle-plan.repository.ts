import { and, eq, gt, lt, or } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { LocalDate } from "../../../common/domain/local-date";
import { plans } from "../../../infrastructure/database/schema/planning";
import type { TripPeriod } from "../domain/trip-period";
import type { PlanRepository } from "../adapter/outbound/plan.repository";

/**
 * M2-a3 では期間の変更の判定に使う読み取りだけ。取りやめ済みも含めるため
 * cancelled_at で絞り込まない。
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
}
