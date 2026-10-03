import { ApiError } from "../../../common/http/api-error";
import type { Clock } from "../../../adapter/clock/clock";
import type { UnitOfWork } from "../../../adapter/transaction/unit-of-work";
import {
  CHANGE_TRIP_PERIOD_OPERATION,
  type ChangeTripPeriodInput,
  type ChangeTripPeriodInputPort,
} from "../adapter/inbound/change-trip-period.input-port";
import type { TripWriteResult } from "../adapter/inbound/trip-write.result";
import type { PlanningWorkContext } from "../adapter/outbound/planning-work-context";
import type { WriteLog } from "../adapter/outbound/write-log.port";
import { Trip } from "../domain/trip";
import { parseTripPeriod } from "./trip-input";
import {
  executeTripWrite,
  runTripUpdate,
  type TripUpdateCommand,
} from "./trip-write-flow";

export class ChangeTripPeriodUseCase implements ChangeTripPeriodInputPort {
  constructor(
    private readonly unitOfWork: UnitOfWork<PlanningWorkContext>,
    private readonly clock: Clock,
    private readonly writeLog: WriteLog,
  ) {}

  execute(input: ChangeTripPeriodInput): Promise<TripWriteResult> {
    const period = parseTripPeriod(input.startsOn, input.endsOn);
    const command: TripUpdateCommand = {
      userId: input.userId,
      tripId: input.tripId,
      operation: CHANGE_TRIP_PERIOD_OPERATION,
      key: input.key,
      ifMatch: input.ifMatch,
      requestHash: input.requestHash,
    };
    return executeTripWrite(
      this.writeLog,
      CHANGE_TRIP_PERIOD_OPERATION,
      input.tripId,
      () =>
        this.unitOfWork.run((ctx) =>
          runTripUpdate(ctx, command, async (trip, context) => {
            // 取りやめ済みを含む全予定が新しい期間に収まるかを見る
            // （M2-bの予定APIはこの同じ規則を使う）。
            const outside = await context.plans.datesOutside(trip.id, period);
            if (outside.length > 0) {
              throw new ApiError({
                code: "PLAN_OUTSIDE_TRIP_PERIOD",
                status: 422,
                message: "Plans exist outside the new trip period",
              });
            }
            return Trip.changePeriod(trip, period, this.clock.now());
          }),
        ),
    );
  }
}
