import { LocalDate } from "../../../common/domain/local-date";

/**
 * 旅行期間。開始日 ≦ 終了日。両端の日を含む。
 */
export type TripPeriod = Readonly<{
  startsOn: LocalDate;
  endsOn: LocalDate;
}>;

export const TripPeriod = {
  /**
   * @throws 開始日が終了日より後のとき Error を投げる。
   */
  create(startsOn: LocalDate, endsOn: LocalDate): TripPeriod {
    if (LocalDate.compare(startsOn, endsOn) > 0) {
      throw new Error("TripPeriod must not be reversed");
    }
    return { startsOn, endsOn };
  },

  /**
   * date が期間に含まれるか（開始日・終了日を含む）。
   */
  contains(period: TripPeriod, date: LocalDate): boolean {
    return (
      LocalDate.compare(period.startsOn, date) <= 0 &&
      LocalDate.compare(date, period.endsOn) <= 0
    );
  },
};
