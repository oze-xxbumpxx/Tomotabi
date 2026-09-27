import type { UserId } from "../../../../common/domain/user-id";
import type { Trip, TripStatus } from "../../domain/trip";

export const PLANNING_READ_PORT = Symbol("PLANNING_READ_PORT");

export type TripListCursor = Readonly<{
  createdAt: Date;
  id: string;
}>;

export type TripListQuery = Readonly<{
  status: TripStatus | null;
  after: TripListCursor | null;
  limit: number;
}>;

export type TripListPage = Readonly<{
  items: Trip[];
  nextCursor: TripListCursor | null;
}>;

/**
 * 一覧・取得の読み取り。UnitOfWork の文脈ではなくプールから直接読む
 * （設計書「変更後構成」の planning-read.port）。
 */
export interface PlanningReadPort {
  /**
   * 参加していない・存在しない旅行は null を返す（区別しない）。
   */
  findTripForParticipant(
    tripId: string,
    userId: UserId,
  ): Promise<Trip | null>;

  /**
   * userId が参加する旅行を created_at DESC, id DESC で返す。
   * after があれば (created_at, id) が after より古い側のページを返す。
   */
  listTripsForParticipant(
    userId: UserId,
    query: TripListQuery,
  ): Promise<TripListPage>;
}
