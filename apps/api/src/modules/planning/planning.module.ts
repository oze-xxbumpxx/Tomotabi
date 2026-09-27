import { Module } from "@nestjs/common";
import { CLOCK, type Clock } from "../../adapter/clock/clock";
import type { UnitOfWork } from "../../adapter/transaction/unit-of-work";
import { PlanningCompositionModule } from "../../composition/planning-composition.module";
import {
  CREATE_TRIP_INPUT_PORT,
  type CreateTripInputPort,
} from "./adapter/inbound/create-trip.input-port";
import {
  GET_TRIP_INPUT_PORT,
  type GetTripInputPort,
} from "./adapter/inbound/get-trip.input-port";
import {
  LIST_TRIPS_INPUT_PORT,
  type ListTripsInputPort,
} from "./adapter/inbound/list-trips.input-port";
import {
  RENAME_TRIP_INPUT_PORT,
  type RenameTripInputPort,
} from "./adapter/inbound/rename-trip.input-port";
import {
  CHANGE_TRIP_PERIOD_INPUT_PORT,
  type ChangeTripPeriodInputPort,
} from "./adapter/inbound/change-trip-period.input-port";
import {
  FINISH_TRIP_INPUT_PORT,
  type FinishTripInputPort,
} from "./adapter/inbound/finish-trip.input-port";
import {
  START_TRIP_INPUT_PORT,
  type StartTripInputPort,
} from "./adapter/inbound/start-trip.input-port";
import {
  PLANNING_READ_PORT,
  type PlanningReadPort,
} from "./adapter/outbound/planning-read.port";
import {
  PLANNING_UNIT_OF_WORK,
  type PlanningWorkContext,
} from "./adapter/outbound/planning-work-context";
import {
  WRITE_LOG,
  type WriteLog,
} from "./adapter/outbound/write-log.port";
import { TripsController } from "./controller/trips.controller";
import { CreateTripUseCase } from "./usecase/create-trip.usecase";
import { GetTripUseCase } from "./usecase/get-trip.usecase";
import { ListTripsUseCase } from "./usecase/list-trips.usecase";
import { RenameTripUseCase } from "./usecase/rename-trip.usecase";
import { ChangeTripPeriodUseCase } from "./usecase/change-trip-period.usecase";
import { FinishTripUseCase } from "./usecase/finish-trip.usecase";
import { StartTripUseCase } from "./usecase/start-trip.usecase";

type WriteDeps = [
  uow: UnitOfWork<PlanningWorkContext>,
  clock: Clock,
  writeLog: WriteLog,
];
const WRITE_INJECT = [PLANNING_UNIT_OF_WORK, CLOCK, WRITE_LOG];

@Module({
  imports: [PlanningCompositionModule],
  controllers: [TripsController],
  providers: [
    {
      provide: CREATE_TRIP_INPUT_PORT,
      useFactory: (...deps: WriteDeps): CreateTripInputPort =>
        new CreateTripUseCase(...deps),
      inject: WRITE_INJECT,
    },
    {
      provide: LIST_TRIPS_INPUT_PORT,
      useFactory: (read: PlanningReadPort): ListTripsInputPort =>
        new ListTripsUseCase(read),
      inject: [PLANNING_READ_PORT],
    },
    {
      provide: GET_TRIP_INPUT_PORT,
      useFactory: (read: PlanningReadPort): GetTripInputPort =>
        new GetTripUseCase(read),
      inject: [PLANNING_READ_PORT],
    },
    {
      provide: RENAME_TRIP_INPUT_PORT,
      useFactory: (...deps: WriteDeps): RenameTripInputPort =>
        new RenameTripUseCase(...deps),
      inject: WRITE_INJECT,
    },
    {
      provide: CHANGE_TRIP_PERIOD_INPUT_PORT,
      useFactory: (...deps: WriteDeps): ChangeTripPeriodInputPort =>
        new ChangeTripPeriodUseCase(...deps),
      inject: WRITE_INJECT,
    },
    {
      provide: START_TRIP_INPUT_PORT,
      useFactory: (...deps: WriteDeps): StartTripInputPort =>
        new StartTripUseCase(...deps),
      inject: WRITE_INJECT,
    },
    {
      provide: FINISH_TRIP_INPUT_PORT,
      useFactory: (...deps: WriteDeps): FinishTripInputPort =>
        new FinishTripUseCase(...deps),
      inject: WRITE_INJECT,
    },
  ],
})
export class PlanningModule {}
