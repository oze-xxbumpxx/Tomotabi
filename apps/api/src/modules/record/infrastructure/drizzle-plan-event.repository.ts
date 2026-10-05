import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { UserId } from "../../../common/domain/user-id";
import {
  activePlanEvents,
  planEventCancellations,
  planEvents,
} from "../../../infrastructure/database/schema/record";
import type { PlanEventRepository } from "../adapter/outbound/plan-event.repository";
import type {
  NewPlanEvent,
  NewPlanEventCancellation,
  PlanEvent,
  PlanEventCancellation,
  PlanEventKind,
} from "../domain/plan-event";

type PlanEventRow = typeof planEvents.$inferSelect;
type CancellationRow = typeof planEventCancellations.$inferSelect;

function toPlanEventDomain(row: PlanEventRow): PlanEvent {
  return {
    id: row.id,
    tripId: row.tripId,
    planId: row.planId,
    kind: row.eventKind as PlanEventKind,
    createdBy: UserId.parse(row.createdBy),
    createdAt: row.createdAt,
  };
}

function toCancellationDomain(row: CancellationRow): PlanEventCancellation {
  return {
    eventId: row.eventId,
    tripId: row.tripId,
    cancelledBy: UserId.parse(row.cancelledBy),
    createdAt: row.createdAt,
  };
}

/**
 * 達成・予約の記録のDrizzle実装。履歴の表はINSERTだけ（append-onlyの
 * トリガがUPDATE・DELETEを拒む）。有効な記録は占有行の足し・消しで
 * 表す（1予定・1種類で1件。PK違反はUseCaseが409に写す）。
 */
export class DrizzlePlanEventRepository implements PlanEventRepository {
  constructor(private readonly db: NodePgDatabase) {}

  async findActiveId(
    planId: string,
    kind: PlanEventKind,
  ): Promise<string | null> {
    const rows = await this.db
      .select({ eventId: activePlanEvents.eventId })
      .from(activePlanEvents)
      .where(
        and(
          eq(activePlanEvents.planId, planId),
          eq(activePlanEvents.eventKind, kind),
        ),
      );
    return rows[0]?.eventId ?? null;
  }

  async insert(event: NewPlanEvent): Promise<PlanEvent> {
    const rows = await this.db
      .insert(planEvents)
      .values({
        tripId: event.tripId,
        planId: event.planId,
        eventKind: event.kind,
        createdBy: event.createdBy,
      })
      .returning();
    return toPlanEventDomain(rows[0]!);
  }

  async insertActive(event: PlanEvent): Promise<void> {
    await this.db.insert(activePlanEvents).values({
      tripId: event.tripId,
      planId: event.planId,
      eventKind: event.kind,
      eventId: event.id,
    });
  }

  async findInTrip(
    tripId: string,
    eventId: string,
  ): Promise<PlanEvent | null> {
    const rows = await this.db
      .select()
      .from(planEvents)
      .where(and(eq(planEvents.tripId, tripId), eq(planEvents.id, eventId)));
    return rows[0] === undefined ? null : toPlanEventDomain(rows[0]);
  }

  async findCancellationInTrip(
    tripId: string,
    eventId: string,
  ): Promise<PlanEventCancellation | null> {
    const rows = await this.db
      .select()
      .from(planEventCancellations)
      .where(
        and(
          eq(planEventCancellations.tripId, tripId),
          eq(planEventCancellations.eventId, eventId),
        ),
      );
    return rows[0] === undefined ? null : toCancellationDomain(rows[0]);
  }

  async insertCancellation(
    cancellation: NewPlanEventCancellation,
  ): Promise<PlanEventCancellation> {
    const rows = await this.db
      .insert(planEventCancellations)
      .values({
        eventId: cancellation.eventId,
        tripId: cancellation.tripId,
        cancelledBy: cancellation.cancelledBy,
      })
      .returning();
    return toCancellationDomain(rows[0]!);
  }

  async deleteActive(eventId: string): Promise<void> {
    await this.db
      .delete(activePlanEvents)
      .where(eq(activePlanEvents.eventId, eventId));
  }
}
