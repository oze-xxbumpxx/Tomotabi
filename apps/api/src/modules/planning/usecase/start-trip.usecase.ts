import type { Clock } from "../../../adapter/clock/clock";
import type { UnitOfWork } from "../../../adapter/transaction/unit-of-work";
import {
  START_TRIP_OPERATION,
  type StartTripInput,
  type StartTripInputPort,
} from "../adapter/inbound/start-trip.input-port";
import type { TripWriteResult } from "../adapter/inbound/trip-write.result";
import type { PlanningWorkContext } from "../adapter/outbound/planning-work-context";
import type { WriteLog } from "../adapter/outbound/write-log.port";
import { Trip } from "../domain/trip";
import {
  executeTripWrite,
  runTripUpdate,
  type TripUpdateCommand,
} from "./trip-write-flow";

export class StartTripUseCase implements StartTripInputPort {
  constructor(
    private readonly unitOfWork: UnitOfWork<PlanningWorkContext>,
    private readonly clock: Clock,
    private readonly writeLog: WriteLog,
  ) {}

  execute(input: StartTripInput): Promise<TripWriteResult> {
    const command: TripUpdateCommand = {
      userId: input.userId,
      tripId: input.tripId,
      operation: START_TRIP_OPERATION,
      key: input.key,
      ifMatch: input.ifMatch,
      requestHash: input.requestHash,
    };
    return executeTripWrite(
      this.writeLog,
      START_TRIP_OPERATION,
      input.tripId,
      () =>
        this.unitOfWork.run((ctx) =>
          runTripUpdate(ctx, command, (trip) =>
            Promise.resolve(
              Trip.start(trip, this.clock.now(), input.userId),
            ),
          ),
        ),
    );
  }
}
