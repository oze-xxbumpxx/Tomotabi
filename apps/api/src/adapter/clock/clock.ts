import type { LocalDate } from "../../common/domain/local-date";

export const CLOCK = Symbol("CLOCK");

/**
 * 現在時刻のIF。「今日」はAsia/Tokyoの暦日（UTCの15:00をまたぐ境界で
 * 日付が変わる）。
 */
export interface Clock {
  /** 現在の瞬間を返す。 */
  now(): Date;
  /** Asia/Tokyoの今日の日付を返す。 */
  today(): LocalDate;
}
