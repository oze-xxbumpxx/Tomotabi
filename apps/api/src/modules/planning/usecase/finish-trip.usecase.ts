import type { Clock } from "../../../adapter/clock/clock";
import type { UnitOfWork } from "../../../adapter/transaction/unit-of-work";
import {
  FINISH_TRIP_OPERATION,
  type FinishTripInput,
  type FinishTripInputPort,
} from "../adapter/inbound/finish-trip.input-port";
import type { TripWriteResult } from "../adapter/inbound/trip-write.result";
import type { PlanningWorkContext } from "../adapter/outbound/planning-work-context";
import type { WriteLog } from "../adapter/outbound/write-log.port";
import { Trip } from "../domain/trip";
import {
  executeTripWrite,
  runTripUpdate,
  type TripUpdateCommand,
} from "./trip-write-flow";

export class FinishTripUseCase implements FinishTripInputPort {
  constructor(
    private readonly unitOfWork: UnitOfWork<PlanningWorkContext>,
    private readonly clock: Clock,
    private readonly writeLog: WriteLog,
  ) {}

  execute(input: FinishTripInput): Promise<TripWriteResult> {
    const command: TripUpdateCommand = {
      userId: input.userId,
      tripId: input.tripId,
      operation: FINISH_TRIP_OPERATION,
      key: input.key,
      ifMatch: input.ifMatch,
      requestHash: input.requestHash,
    };
    return executeTripWrite(
      this.writeLog,
      FINISH_TRIP_OPERATION,
      input.tripId,
      () =>
        this.unitOfWork.run((ctx) =>
          runTripUpdate(ctx, command, (trip) =>
            Promise.resolve(
              Trip.finish(trip, this.clock.now(), input.userId),
            ),
          ),
        ),
    );
  }
}
