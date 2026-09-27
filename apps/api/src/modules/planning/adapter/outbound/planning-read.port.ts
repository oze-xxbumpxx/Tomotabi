import type { UserId } from "../../../../common/domain/user-id";
import type { Trip, TripStatus } from "../../domain/trip";

export const PLANNING_READ_PORT = Symbol("PLANNING_READ_PORT");

/** カーソルの中身（利用者からは不透明）。起点の旅行 id だけを持つ。 */
export type TripListCursor = Readonly<{
  id: string;
}>;

/**
 * DB で解決したページの起点。createdAt は `created_at::text` の文字列で、
 * JS の Date（ミリ秒）に変換しない（同じミリ秒内の行を区別できなくなる）。
 */
export type TripListAnchor = Readonly<{
  createdAt: string;
  id: string;
}>;

export type TripListQuery = Readonly<{
  status: TripStatus | null;
  after: TripListAnchor | null;
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
   * カーソルの起点を参加者スコープで解決する。created_at は `::text` で
   * マイクロ秒のまま返す。参加していない・存在しない id は null を返し、
   * 呼び出し側が同じ形の 400 に写す（存在を漏らさない）。
   */
  findTripAnchor(
    tripId: string,
    userId: UserId,
  ): Promise<TripListAnchor | null>;

  /**
   * userId が参加する旅行を created_at DESC, id DESC で返す。
   * after があれば (created_at, id) が after より古い側のページを返す。
   */
  listTripsForParticipant(
    userId: UserId,
    query: TripListQuery,
  ): Promise<TripListPage>;
}
