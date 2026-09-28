import type { Clock } from "../../../adapter/clock/clock";
import type { UnitOfWork } from "../../../adapter/transaction/unit-of-work";
import {
  RENAME_TRIP_OPERATION,
  type RenameTripInput,
  type RenameTripInputPort,
} from "../adapter/inbound/rename-trip.input-port";
import type { TripWriteResult } from "../adapter/inbound/trip-write.result";
import type { PlanningWorkContext } from "../adapter/outbound/planning-work-context";
import type { WriteLog } from "../adapter/outbound/write-log.port";
import { Trip } from "../domain/trip";
import { parseTripName } from "./trip-input";
import {
  executeTripWrite,
  runTripUpdate,
  type TripUpdateCommand,
} from "./trip-write-flow";

export class RenameTripUseCase implements RenameTripInputPort {
  constructor(
    private readonly unitOfWork: UnitOfWork<PlanningWorkContext>,
    private readonly clock: Clock,
    private readonly writeLog: WriteLog,
  ) {}

  execute(input: RenameTripInput): Promise<TripWriteResult> {
    const name = parseTripName(input.name);
    const command: TripUpdateCommand = {
      userId: input.userId,
      tripId: input.tripId,
      operation: RENAME_TRIP_OPERATION,
      key: input.key,
      ifMatch: input.ifMatch,
      requestHash: input.requestHash,
    };
    return executeTripWrite(
      this.writeLog,
      RENAME_TRIP_OPERATION,
      input.tripId,
      () =>
        this.unitOfWork.run((ctx) =>
          runTripUpdate(ctx, command, (trip) =>
            Promise.resolve(Trip.rename(trip, name, this.clock.now())),
          ),
        ),
    );
  }
}
