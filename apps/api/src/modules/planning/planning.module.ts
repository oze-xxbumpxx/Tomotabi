import { Module } from "@nestjs/common";
import { CLOCK, type Clock } from "../../adapter/clock/clock.js";
import type { UnitOfWork } from "../../adapter/transaction/unit-of-work.js";
import { PlanningCompositionModule } from "../../composition/planning-composition.module.js";
import {
  CANCEL_PLAN_INPUT_PORT,
  type CancelPlanInputPort,
} from "./adapter/inbound/cancel-plan.input-port.js";
import {
  CREATE_PLAN_INPUT_PORT,
  type CreatePlanInputPort,
} from "./adapter/inbound/create-plan.input-port.js";
import {
  CREATE_TRIP_INPUT_PORT,
  type CreateTripInputPort,
} from "./adapter/inbound/create-trip.input-port.js";
import { PinoLogger } from "nestjs-pino";
import {
  GET_HOME_INPUT_PORT,
  type GetHomeInputPort,
} from "./adapter/inbound/get-home.input-port.js";
import {
  GET_ITINERARY_INPUT_PORT,
  type GetItineraryInputPort,
} from "./adapter/inbound/get-itinerary.input-port.js";
import {
  GET_PLAN_INPUT_PORT,
  type GetPlanInputPort,
} from "./adapter/inbound/get-plan.input-port.js";
import {
  GET_TRIP_INPUT_PORT,
  type GetTripInputPort,
} from "./adapter/inbound/get-trip.input-port.js";
import {
  LIST_TRIPS_INPUT_PORT,
  type ListTripsInputPort,
} from "./adapter/inbound/list-trips.input-port.js";
import {
  MOVE_PLAN_INPUT_PORT,
  type MovePlanInputPort,
} from "./adapter/inbound/move-plan.input-port.js";
import {
  RENAME_TRIP_INPUT_PORT,
  type RenameTripInputPort,
} from "./adapter/inbound/rename-trip.input-port.js";
import {
  CHANGE_TRIP_PERIOD_INPUT_PORT,
  type ChangeTripPeriodInputPort,
} from "./adapter/inbound/change-trip-period.input-port.js";
import {
  FINISH_TRIP_INPUT_PORT,
  type FinishTripInputPort,
} from "./adapter/inbound/finish-trip.input-port.js";
import {
  START_TRIP_INPUT_PORT,
  type StartTripInputPort,
} from "./adapter/inbound/start-trip.input-port.js";
import {
  UPDATE_PLAN_INPUT_PORT,
  type UpdatePlanInputPort,
} from "./adapter/inbound/update-plan.input-port.js";
import {
  HOME_READ_UNIT_OF_WORK,
  type HomeReadUnitOfWork,
} from "./adapter/outbound/home-read.port.js";
import {
  PLANNING_READ_PORT,
  type PlanningReadPort,
} from "./adapter/outbound/planning-read.port.js";
import {
  PLANNING_UNIT_OF_WORK,
  type PlanningWorkContext,
} from "./adapter/outbound/planning-work-context.js";
import {
  NOTIFICATION_PUBLISHER,
  type NotificationPublisher,
} from "./adapter/outbound/notification-publisher.js";
import {
  WRITE_LOG,
  type WriteLog,
} from "./adapter/outbound/write-log.port.js";
import { HomeController } from "./controller/home.controller.js";
import { PlansController } from "./controller/plans.controller.js";
import { TripsController } from "./controller/trips.controller.js";
import { CancelPlanUseCase } from "./usecase/cancel-plan.usecase.js";
import { CreatePlanUseCase } from "./usecase/create-plan.usecase.js";
import { CreateTripUseCase } from "./usecase/create-trip.usecase.js";
import { GetHomeUseCase } from "./usecase/get-home.usecase.js";
import { GetItineraryUseCase } from "./usecase/get-itinerary.usecase.js";
import { GetPlanUseCase } from "./usecase/get-plan.usecase.js";
import { GetTripUseCase } from "./usecase/get-trip.usecase.js";
import { ListTripsUseCase } from "./usecase/list-trips.usecase.js";
import { MovePlanUseCase } from "./usecase/move-plan.usecase.js";
import { RenameTripUseCase } from "./usecase/rename-trip.usecase.js";
import { ChangeTripPeriodUseCase } from "./usecase/change-trip-period.usecase.js";
import { FinishTripUseCase } from "./usecase/finish-trip.usecase.js";
import { StartTripUseCase } from "./usecase/start-trip.usecase.js";
import { UpdatePlanUseCase } from "./usecase/update-plan.usecase.js";

type WriteDeps = [
  uow: UnitOfWork<PlanningWorkContext>,
  clock: Clock,
  writeLog: WriteLog,
];
const WRITE_INJECT = [PLANNING_UNIT_OF_WORK, CLOCK, WRITE_LOG];

// 通知のイベントを渡す書き込み（予定の追加・取りやめ・日の移動）は
// publisherも受け取る。
type PlanWriteDeps = [...WriteDeps, publisher: NotificationPublisher];
const PLAN_WRITE_INJECT = [
  PLANNING_UNIT_OF_WORK,
  CLOCK,
  WRITE_LOG,
  NOTIFICATION_PUBLISHER,
];

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
      useFactory: (...deps: PlanWriteDeps): CreatePlanInputPort =>
        new CreatePlanUseCase(...deps),
      inject: PLAN_WRITE_INJECT,
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
      useFactory: (...deps: PlanWriteDeps): MovePlanInputPort =>
        new MovePlanUseCase(...deps),
      inject: PLAN_WRITE_INJECT,
    },
    {
      provide: CANCEL_PLAN_INPUT_PORT,
      useFactory: (...deps: PlanWriteDeps): CancelPlanInputPort =>
        new CancelPlanUseCase(...deps),
      inject: PLAN_WRITE_INJECT,
    },
  ],
})
export class PlanningModule {}
