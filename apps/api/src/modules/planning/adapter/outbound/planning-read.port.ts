import type { UserId } from "../../../../common/domain/user-id";
import type { LocalDate } from "../../../../common/domain/local-date";
import type { Plan } from "../../domain/plan";
import type { Trip, TripStatus } from "../../domain/trip";
import type { ActivePlanEvent } from "./record-history.port";

export const PLANNING_READ_PORT = Symbol("PLANNING_READ_PORT");

/** カーソルの中身（利用者からは不透明）。起点の旅行idだけを持つ。 */
export type TripListCursor = Readonly<{
  id: string;
}>;

/**
 * DBで解決したページの起点。createdAtは`created_at::text`の文字列で、
 * JSのDate（ミリ秒）に変換しない（同じミリ秒内の行を区別できなくなる）。
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
 * 予定1件と画面表示用の結合結果。
 * achievement / bookingは有効な行だけ（無ければnull）。
 * hasRecordHistoryは取り消し済みを含む履歴の有無（種類変更の可否判定用）。
 */
export type PlanView = Readonly<{
  plan: Plan;
  achievement: ActivePlanEvent | null;
  booking: ActivePlanEvent | null;
  hasRecordHistory: boolean;
}>;

/**
 * 一覧・取得の読み取り。UnitOfWorkの文脈ではなくプールから直接読む
 * （設計書「変更後構成」のplanning-read.port）。
 */
export interface PlanningReadPort {
  /**
   * 参加していない・存在しない旅行はnullを返す（区別しない）。
   */
  findTripForParticipant(
    tripId: string,
    userId: UserId,
  ): Promise<Trip | null>;

  /**
   * カーソルの起点を参加者スコープで解決する。created_atは`::text`で
   * マイクロ秒のまま返す。参加していない・存在しないidはnullを返し、
   * 呼び出し側が同じ形の400に写す（存在を漏らさない）。
   */
  findTripAnchor(
    tripId: string,
    userId: UserId,
  ): Promise<TripListAnchor | null>;

  /**
   * userIdが参加する旅行をcreated_at DESC, id DESCで返す。
   * afterがあれば(created_at, id)がafterより古い側のページを返す。
   */
  listTripsForParticipant(
    userId: UserId,
    query: TripListQuery,
  ): Promise<TripListPage>;

  /**
   * 旅行の中の予定を1件返す。別の旅行の予定・無い予定はnullを返す
   * （呼び出し側が同じ形の404に写し、存在を漏らさない）。
   * 参加確認は呼び出し側がfindTripForParticipantで済ませている前提。
   */
  findPlanInTrip(tripId: string, planId: string): Promise<PlanView | null>;

  /**
   * 指定日の予定をすべて返す（取りやめ済みを含む）。
   * 並びは時刻の早い順・時刻未定は末尾・登録日時・id（詳細設計04 §4）。
   */
  listPlansForDay(tripId: string, date: LocalDate): Promise<PlanView[]>;
}
