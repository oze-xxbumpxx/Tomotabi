import { and, eq, exists, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { LockStrength } from "drizzle-orm/pg-core";
import type { BoundedText } from "../../../common/domain/bounded-text";
import { LocalDate } from "../../../common/domain/local-date";
import { UserId } from "../../../common/domain/user-id";
import {
  tripParticipants,
  trips,
} from "../../../infrastructure/database/schema/planning";
import type { Trip, TripStatus } from "../domain/trip";
import { TripPeriod } from "../domain/trip-period";
import type {
  NewTrip,
  TripParticipantSlot,
  TripRepository,
} from "../adapter/outbound/trip.repository";

type TripRow = typeof trips.$inferSelect;

export function toTripDomain(row: TripRow): Trip {
  return {
    id: row.id,
    name: row.name as BoundedText,
    period: TripPeriod.create(
      LocalDate.parse(row.startsOn),
      LocalDate.parse(row.endsOn),
    ),
    status: row.status as TripStatus,
    version: row.version,
    createdBy: UserId.parse(row.createdBy),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    startedAt: row.startedAt,
    startedBy: row.startedBy === null ? null : UserId.parse(row.startedBy),
    finishedAt: row.finishedAt,
    finishedBy: row.finishedBy === null ? null : UserId.parse(row.finishedBy),
  };
}

export class DrizzleTripRepository implements TripRepository {
  constructor(private readonly db: NodePgDatabase) {}

  lockForUpdate(tripId: string, actorId: UserId): Promise<Trip | null> {
    return this.lock(tripId, actorId, "update");
  }

  lockForShare(tripId: string, actorId: UserId): Promise<Trip | null> {
    return this.lock(tripId, actorId, "share");
  }

  async insert(trip: NewTrip): Promise<Trip> {
    const rows = await this.db
      .insert(trips)
      .values({
        name: trip.name,
        startsOn: trip.period.startsOn,
        endsOn: trip.period.endsOn,
        createdBy: trip.createdBy,
      })
      .returning();
    return toTripDomain(rows[0]!);
  }

  async insertParticipants(
    tripId: string,
    participants: readonly TripParticipantSlot[],
  ): Promise<void> {
    await this.db.insert(tripParticipants).values(
      participants.map((participant) => ({
        tripId,
        slot: participant.slot,
        userId: participant.userId,
      })),
    );
  }

  async update(trip: Trip): Promise<void> {
    await this.db
      .update(trips)
      .set({
        name: trip.name,
        startsOn: trip.period.startsOn,
        endsOn: trip.period.endsOn,
        status: trip.status,
        version: trip.version,
        updatedAt: trip.updatedAt,
        startedAt: trip.startedAt,
        startedBy: trip.startedBy,
        finishedAt: trip.finishedAt,
        finishedBy: trip.finishedBy,
      })
      .where(eq(trips.id, trip.id));
  }

  /**
   * 参加者の確認は EXISTS 副問い合わせにする。JOIN で FOR UPDATE / FOR SHARE を
   * 取ると trip_participants の行もロック対象になるが、app_runtime はその表に
   * UPDATE 権限を持たず行ロックできないため。
   */
  private async lock(
    tripId: string,
    actorId: UserId,
    strength: LockStrength,
  ): Promise<Trip | null> {
    const rows = await this.db
      .select()
      .from(trips)
      .where(and(eq(trips.id, tripId), this.participates(actorId)))
      .for(strength);
    return rows[0] === undefined ? null : toTripDomain(rows[0]);
  }

  private participates(actorId: UserId) {
    return exists(
      this.db
        .select({ _: sql`1` })
        .from(tripParticipants)
        .where(
          and(
            eq(tripParticipants.tripId, trips.id),
            eq(tripParticipants.userId, actorId),
          ),
        ),
    );
  }
}
