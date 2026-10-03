import type { Trip as TripContract } from "@tomotabi/contracts";
import type { Trip } from "../domain/trip";

/**
 * Domainの旅行を公開契約の形にする。versionは10進の文字列（ETagの中身）。
 */
export function toTripDto(trip: Trip): TripContract {
  return {
    id: trip.id,
    name: trip.name,
    startsOn: trip.period.startsOn,
    endsOn: trip.period.endsOn,
    status: trip.status,
    version: String(trip.version),
    createdAt: trip.createdAt.toISOString(),
    startedAt: trip.startedAt === null ? null : trip.startedAt.toISOString(),
    finishedAt:
      trip.finishedAt === null ? null : trip.finishedAt.toISOString(),
    createdBy: trip.createdBy,
    startedBy: trip.startedBy,
    finishedBy: trip.finishedBy,
  };
}
