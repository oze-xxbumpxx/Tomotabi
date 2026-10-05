import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { DrizzlePlanRepository } from "../../planning/infrastructure/drizzle-plan.repository";
import type {
  PlanEligibility,
  PlanEligibilityPort,
} from "../adapter/outbound/plan-eligibility.port";

/**
 * PlanEligibilityPortをplanningの予定の読み取りにつなぐ実装。
 * 予定行のロックは予定の書き込みと同じFOR NO KEY UPDATEで取るので、
 * 記録の書き込みは種類変更・取りやめと予定行で一列に並ぶ。
 * UoWのトランザクション内から呼ばれるため、dbハンドルを外から受ける。
 */
export class PgPlanEligibilityQuery implements PlanEligibilityPort {
  constructor(private readonly db: NodePgDatabase) {}

  async lockForUpdate(
    tripId: string,
    planId: string,
  ): Promise<PlanEligibility | null> {
    const plan = await new DrizzlePlanRepository(this.db).lockForUpdate(
      tripId,
      planId,
    );
    if (plan === null) {
      return null;
    }
    return {
      id: plan.id,
      tripId: plan.tripId,
      kind: plan.kind,
      cancelledAt: plan.cancelledAt,
    };
  }
}
