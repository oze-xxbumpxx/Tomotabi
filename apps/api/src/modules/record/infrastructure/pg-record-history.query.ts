import { eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { EventKind } from "@tomotabi/contracts";
import { UserId } from "../../../common/domain/user-id";
import {
  activePlanEvents,
  planEvents,
} from "../../../infrastructure/database/schema/record";
import type {
  ActivePlanEvent,
  RecordHistoryPort,
} from "../../planning/adapter/outbound/record-history.port";

/**
 * recordモジュールの公開照会。planningの予定の更新・取得が使う。
 * UoWのトランザクション内からも呼ばれるため、dbハンドルを外から受ける
 * （予定行のロックを持ったまま履歴を照会するE-19のため）。
 */
export class PgRecordHistoryQuery implements RecordHistoryPort {
  constructor(private readonly db: NodePgDatabase) {}

  /**
   * 履歴の有無はplan_eventsの存在で判定する。取り消し済みの行も残る
   * append-only表なので、取り消しを含めて「一度でもあれば」になる。
   */
  async hasHistory(planId: string): Promise<boolean> {
    const rows = await this.db
      .select({ _: sql`1` })
      .from(planEvents)
      .where(eq(planEvents.planId, planId))
      .limit(1);
    return rows.length > 0;
  }

  async activeEvents(
    planId: string,
  ): Promise<{
    achievement: ActivePlanEvent | null;
    booking: ActivePlanEvent | null;
  }> {
    const rows = await this.db
      .select({ event: planEvents })
      .from(activePlanEvents)
      .innerJoin(planEvents, eq(planEvents.id, activePlanEvents.eventId))
      .where(eq(activePlanEvents.planId, planId));
    let achievement: ActivePlanEvent | null = null;
    let booking: ActivePlanEvent | null = null;
    for (const row of rows) {
      const event: ActivePlanEvent = {
        id: row.event.id,
        tripId: row.event.tripId,
        planId: row.event.planId,
        kind: row.event.eventKind as EventKind,
        createdBy: UserId.parse(row.event.createdBy),
        createdAt: row.event.createdAt,
      };
      if (event.kind === "achievement") {
        achievement = event;
      } else {
        booking = event;
      }
    }
    return { achievement, booking };
  }
}
