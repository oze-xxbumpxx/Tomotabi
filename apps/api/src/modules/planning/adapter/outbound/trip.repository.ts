import type { BoundedText } from "../../../../common/domain/bounded-text";
import type { UserId } from "../../../../common/domain/user-id";
import type { Trip } from "../../domain/trip";
import type { TripPeriod } from "../../domain/trip-period";

export type NewTrip = Readonly<{
  name: BoundedText;
  period: TripPeriod;
  createdBy: UserId;
}>;

export type TripParticipantSlot = Readonly<{
  slot: number;
  userId: UserId;
}>;

/**
 * 旅行行の永続化。lockFor* は「旅行が存在し、actorId がその参加者」のときだけ
 * 行を返す。存在しない・参加していないは同じ null で、どちらでも
 * 403 TRIP_NOT_ACCESSIBLE にする（存在を漏らさない。設計書「正本からの差分」3）。
 */
export interface TripRepository {
  lockForUpdate(tripId: string, actorId: UserId): Promise<Trip | null>;
  lockForShare(tripId: string, actorId: UserId): Promise<Trip | null>;
  insert(trip: NewTrip): Promise<Trip>;
  insertParticipants(
    tripId: string,
    participants: readonly TripParticipantSlot[],
  ): Promise<void>;
  update(trip: Trip): Promise<void>;
}
