import type { LocalDate } from "../../common/domain/local-date";

export const CLOCK = Symbol("CLOCK");

/**
 * 現在時刻の IF。「今日」は Asia/Tokyo の暦日（UTC の 15:00 をまたぐ境界で
 * 日付が変わる）。
 */
export interface Clock {
  /** 現在の瞬間を返す。 */
  now(): Date;
  /** Asia/Tokyo の今日の日付を返す。 */
  today(): LocalDate;
}
