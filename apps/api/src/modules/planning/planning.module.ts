import { Module } from "@nestjs/common";
import { CLOCK, type Clock } from "../../adapter/clock/clock";
import type { UnitOfWork } from "../../adapter/transaction/unit-of-work";
import { PlanningCompositionModule } from "../../composition/planning-composition.module";
import {
  CANCEL_PLAN_INPUT_PORT,
  type CancelPlanInputPort,
} from "./adapter/inbound/cancel-plan.input-port";
import {
  CREATE_PLAN_INPUT_PORT,
  type CreatePlanInputPort,
} from "./adapter/inbound/create-plan.input-port";
import {
  CREATE_TRIP_INPUT_PORT,
  type CreateTripInputPort,
} from "./adapter/inbound/create-trip.input-port";
import { PinoLogger } from "nestjs-pino";
import {
  GET_HOME_INPUT_PORT,
  type GetHomeInputPort,
} from "./adapter/inbound/get-home.input-port";
import {
  GET_ITINERARY_INPUT_PORT,
  type GetItineraryInputPort,
} from "./adapter/inbound/get-itinerary.input-port";
import {
  GET_PLAN_INPUT_PORT,
  type GetPlanInputPort,
} from "./adapter/inbound/get-plan.input-port";
import {
  GET_TRIP_INPUT_PORT,
  type GetTripInputPort,
} from "./adapter/inbound/get-trip.input-port";
import {
  LIST_TRIPS_INPUT_PORT,
  type ListTripsInputPort,
} from "./adapter/inbound/list-trips.input-port";
import {
  MOVE_PLAN_INPUT_PORT,
  type MovePlanInputPort,
} from "./adapter/inbound/move-plan.input-port";
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
  UPDATE_PLAN_INPUT_PORT,
  type UpdatePlanInputPort,
} from "./adapter/inbound/update-plan.input-port";
import {
  HOME_READ_UNIT_OF_WORK,
  type HomeReadUnitOfWork,
} from "./adapter/outbound/home-read.port";
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
import { HomeController } from "./controller/home.controller";
import { PlansController } from "./controller/plans.controller";
import { TripsController } from "./controller/trips.controller";
import { CancelPlanUseCase } from "./usecase/cancel-plan.usecase";
import { CreatePlanUseCase } from "./usecase/create-plan.usecase";
import { CreateTripUseCase } from "./usecase/create-trip.usecase";
import { GetHomeUseCase } from "./usecase/get-home.usecase";
import { GetItineraryUseCase } from "./usecase/get-itinerary.usecase";
import { GetPlanUseCase } from "./usecase/get-plan.usecase";
import { GetTripUseCase } from "./usecase/get-trip.usecase";
import { ListTripsUseCase } from "./usecase/list-trips.usecase";
import { MovePlanUseCase } from "./usecase/move-plan.usecase";
import { RenameTripUseCase } from "./usecase/rename-trip.usecase";
import { ChangeTripPeriodUseCase } from "./usecase/change-trip-period.usecase";
import { FinishTripUseCase } from "./usecase/finish-trip.usecase";
import { StartTripUseCase } from "./usecase/start-trip.usecase";
import { UpdatePlanUseCase } from "./usecase/update-plan.usecase";

type WriteDeps = [
  uow: UnitOfWork<PlanningWorkContext>,
  clock: Clock,
  writeLog: WriteLog,
];
const WRITE_INJECT = [PLANNING_UNIT_OF_WORK, CLOCK, WRITE_LOG];

@Module({
  imports: [PlanningCompositionModule],
  controllers: [TripsController, PlansController, HomeController],
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
    {
      provide: GET_ITINERARY_INPUT_PORT,
      useFactory: (read: PlanningReadPort, clock: Clock): GetItineraryInputPort =>
        new GetItineraryUseCase(read, clock),
      inject: [PLANNING_READ_PORT, CLOCK],
    },
    {
      provide: GET_HOME_INPUT_PORT,
      useFactory: (
        uow: HomeReadUnitOfWork,
        clock: Clock,
        logger: PinoLogger,
      ): GetHomeInputPort =>
        new GetHomeUseCase(uow, clock, {
          warn: (entry) => logger.warn(entry),
        }),
      inject: [HOME_READ_UNIT_OF_WORK, CLOCK, PinoLogger],
    },
    {
      provide: CREATE_PLAN_INPUT_PORT,
      useFactory: (...deps: WriteDeps): CreatePlanInputPort =>
        new CreatePlanUseCase(...deps),
      inject: WRITE_INJECT,
    },
    {
      provide: GET_PLAN_INPUT_PORT,
      useFactory: (read: PlanningReadPort): GetPlanInputPort =>
        new GetPlanUseCase(read),
      inject: [PLANNING_READ_PORT],
    },
    {
      provide: UPDATE_PLAN_INPUT_PORT,
      useFactory: (...deps: WriteDeps): UpdatePlanInputPort =>
        new UpdatePlanUseCase(...deps),
      inject: WRITE_INJECT,
    },
    {
      provide: MOVE_PLAN_INPUT_PORT,
      useFactory: (...deps: WriteDeps): MovePlanInputPort =>
        new MovePlanUseCase(...deps),
      inject: WRITE_INJECT,
    },
    {
      provide: CANCEL_PLAN_INPUT_PORT,
      useFactory: (...deps: WriteDeps): CancelPlanInputPort =>
        new CancelPlanUseCase(...deps),
      inject: WRITE_INJECT,
    },
  ],
})
export class PlanningModule {}
