import type { LocalDate } from "../../../../common/domain/local-date";
import type { TripPeriod } from "../../domain/trip-period";

/**
 * 予定行の永続化。M2-a3 では期間の変更の判定に使う日付の読み取りだけを持つ
 * （行ロック・挿入・更新は M2-b で足す）。
 */
export interface PlanRepository {
  /**
   * period の外にある予定日（取りやめ済みを含む全予定）を返す。
   * 行ロックは取らない。呼び出し側が旅行行を FOR UPDATE で持っているため、
   * 予定の追加・移動（旅行行を FOR SHARE で取る）はこの読み取りと互いに待ち、
   * はみ出す予定は成立しない（設計書「ロック順序」E-18）。
   */
  datesOutside(tripId: string, period: TripPeriod): Promise<LocalDate[]>;
}
