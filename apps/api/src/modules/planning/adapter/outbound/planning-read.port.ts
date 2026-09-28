import type { UserId } from "../../../../common/domain/user-id";
import type { LocalDate } from "../../../../common/domain/local-date";
import type { Plan } from "../../domain/plan";
import type { Trip, TripStatus } from "../../domain/trip";
import type { ActivePlanEvent } from "./record-history.port";

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
 * 予定 1 件と画面表示用の結合結果。
 * achievement / booking は有効な行だけ（無ければ null）。
 * hasRecordHistory は取り消し済みを含む履歴の有無（種類変更の可否判定用）。
 */
export type PlanView = Readonly<{
  plan: Plan;
  achievement: ActivePlanEvent | null;
  booking: ActivePlanEvent | null;
  hasRecordHistory: boolean;
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

  /**
   * 旅行の中の予定を 1 件返す。別の旅行の予定・無い予定は null を返す
   * （呼び出し側が同じ形の 404 に写し、存在を漏らさない）。
   * 参加確認は呼び出し側が findTripForParticipant で済ませている前提。
   */
  findPlanInTrip(tripId: string, planId: string): Promise<PlanView | null>;

  /**
   * 指定日の予定をすべて返す（取りやめ済みを含む）。
   * 並びは時刻の早い順・時刻未定は末尾・登録日時・id（詳細設計 04 §4）。
   */
  listPlansForDay(tripId: string, date: LocalDate): Promise<PlanView[]>;
}
