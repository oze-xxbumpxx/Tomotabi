import type { BoundedText } from "../../../../common/domain/bounded-text";
import type { LocalDate } from "../../../../common/domain/local-date";
import type { LocalTime } from "../../../../common/domain/local-time";
import type { Plan } from "../../domain/plan";
import type { PlanKind } from "../../domain/plan-kind";
import type { TripPeriod } from "../../domain/trip-period";

/**
 * 予定の新規作成データ。id / version / created_at / updated_at は DB が埋める。
 */
export type NewPlan = Readonly<{
  tripId: string;
  name: BoundedText;
  kind: PlanKind;
  date: LocalDate;
  time: LocalTime | null;
  memo: BoundedText | null;
}>;

/**
 * 予定の保存。旅行期間の変更と予定の追加・移動は同じ旅行行のロックで順序付ける
 * （期間外の予定が残らないようにするため、E-18）。
 */
export interface PlanRepository {
  /** 期間の外にある予定の日付を返す。旅行行のロック中に呼ぶ（E-18）。 */
  datesOutside(tripId: string, period: TripPeriod): Promise<LocalDate[]>;
  /**
   * 予定行を FOR NO KEY UPDATE でロックして返す。無ければ null。
   * ロックは必ず旅行行のあと（旅行 → 予定）。FOR NO KEY UPDATE は
   * 達成・予約の INSERT と同じ行を取り合うので、種類変更の履歴照会と
   * 同じロックで M4 の記録操作と調和する（E-19）。
   */
  lockForUpdate(tripId: string, planId: string): Promise<Plan | null>;
  /** 予定を追加して、DB が埋めた値を含めて返す。 */
  insert(plan: NewPlan): Promise<Plan>;
  /** 予定行をまるごと更新する。呼び出し前に行ロックを持っていること。 */
  update(plan: Plan): Promise<void>;
}
