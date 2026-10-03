import type { Itinerary } from "@tomotabi/contracts";
import { ApiError } from "../../../common/http/api-error";
import type { Clock } from "../../../adapter/clock/clock";
import type { LocalDate } from "../../../common/domain/local-date";
import type { Trip } from "../domain/trip";
import { TripPeriod } from "../domain/trip-period";
import type {
  GetItineraryInput,
  GetItineraryInputPort,
} from "../adapter/inbound/get-itinerary.input-port";
import type { PlanningReadPort } from "../adapter/outbound/planning-read.port";
import { parsePlanDate } from "./plan-input";
import { toPlanDto } from "./plan-dto";
import { toTripDto } from "./trip-dto";
import { tripNotAccessible } from "./trip-write-flow";

/**
 * 日別しおりの取得。指定日の予定（取りやめ済みを含む）を、有効な
 * 達成・予約と履歴の有無と一緒に1回の読み取りで返す。
 */
export class GetItineraryUseCase implements GetItineraryInputPort {
  constructor(
    private readonly read: PlanningReadPort,
    private readonly clock: Clock,
  ) {}

  async execute(input: GetItineraryInput): Promise<Itinerary> {
    const trip = await this.read.findTripForParticipant(
      input.tripId,
      input.userId,
    );
    if (trip === null) {
      throw tripNotAccessible();
    }
    const date = this.resolveDate(trip, input.date);
    const views = await this.read.listPlansForDay(trip.id, date);
    return {
      trip: toTripDto(trip),
      date,
      plans: views.map((view) => toPlanDto(view.plan, view)),
      fetchedAt: this.clock.now().toISOString(),
    };
  }

  /**
   * 省略時は「日本時間の今日」が期間内なら今日、外なら初日。
   * ClockがAsia/Tokyoの今日を返すので、UTC 15:00の境界はそこに集約済み。
   * 明示した日付は期間外を422で拒否する（画面は期間外を編集できない）。
   */
  private resolveDate(trip: Trip, requested: string | null): LocalDate {
    if (requested !== null) {
      const date = parsePlanDate(requested);
      if (!TripPeriod.contains(trip.period, date)) {
        throw new ApiError({
          code: "PLAN_OUTSIDE_TRIP_PERIOD",
          status: 422,
          message: "date is outside the trip period",
        });
      }
      return date;
    }
    const today = this.clock.today();
    return TripPeriod.contains(trip.period, today)
      ? today
      : trip.period.startsOn;
  }
}
