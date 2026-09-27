import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
} from "@nestjs/common";
import type { Trip, TripPage } from "@tomotabi/contracts";
import type { Response } from "express";
import type { z as zod } from "zod";
import type { UserId } from "../../../common/domain/user-id";
import { CurrentUser } from "../../../common/guard/current-user.decorator";
import { parseIfMatch, toStrongETag } from "../../../common/http/etag";
import {
  parseIdempotencyKey,
  type IdempotencyKey,
} from "../../../common/http/idempotency-key";
import { computeRequestHash } from "../../../common/idempotency/command-receipt";
import { ZodBodyPipe } from "../../../common/http/zod-body.pipe";
import {
  UpdateTripPeriodBody,
  UpdateTripPeriodParams,
} from "../../../generated/planning.zod";
import {
  CreateTripBody,
  FinishTripParams,
  GetTripParams,
  ListTripsQueryParams,
  RenameTripBody,
  RenameTripParams,
  StartTripParams,
} from "../../../generated/trips.zod";
import {
  CREATE_TRIP_INPUT_PORT,
  CREATE_TRIP_OPERATION,
  type CreateTripInputPort,
} from "../adapter/inbound/create-trip.input-port";
import {
  GET_TRIP_INPUT_PORT,
  type GetTripInputPort,
} from "../adapter/inbound/get-trip.input-port";
import {
  LIST_TRIPS_INPUT_PORT,
  type ListTripsInputPort,
} from "../adapter/inbound/list-trips.input-port";
import {
  RENAME_TRIP_INPUT_PORT,
  RENAME_TRIP_OPERATION,
  type RenameTripInputPort,
} from "../adapter/inbound/rename-trip.input-port";
import {
  CHANGE_TRIP_PERIOD_INPUT_PORT,
  CHANGE_TRIP_PERIOD_OPERATION,
  type ChangeTripPeriodInputPort,
} from "../adapter/inbound/change-trip-period.input-port";
import {
  FINISH_TRIP_INPUT_PORT,
  FINISH_TRIP_OPERATION,
  type FinishTripInputPort,
} from "../adapter/inbound/finish-trip.input-port";
import {
  START_TRIP_INPUT_PORT,
  START_TRIP_OPERATION,
  type StartTripInputPort,
} from "../adapter/inbound/start-trip.input-port";
import type { TripWriteResult } from "../adapter/inbound/trip-write.result";

type CreateTripBodyInput = zod.infer<typeof CreateTripBody>;
type ListTripsQueryInput = zod.infer<typeof ListTripsQueryParams>;
type TripParams = zod.infer<typeof GetTripParams>;
type RenameTripBodyInput = zod.infer<typeof RenameTripBody>;
type UpdateTripPeriodBodyInput = zod.infer<typeof UpdateTripPeriodBody>;

@Controller("trips")
export class TripsController {
  constructor(
    @Inject(CREATE_TRIP_INPUT_PORT)
    private readonly createTrip: CreateTripInputPort,
    @Inject(LIST_TRIPS_INPUT_PORT)
    private readonly listTrips: ListTripsInputPort,
    @Inject(GET_TRIP_INPUT_PORT)
    private readonly getTrip: GetTripInputPort,
    @Inject(RENAME_TRIP_INPUT_PORT)
    private readonly renameTrip: RenameTripInputPort,
    @Inject(CHANGE_TRIP_PERIOD_INPUT_PORT)
    private readonly changeTripPeriod: ChangeTripPeriodInputPort,
    @Inject(START_TRIP_INPUT_PORT)
    private readonly startTrip: StartTripInputPort,
    @Inject(FINISH_TRIP_INPUT_PORT)
    private readonly finishTrip: FinishTripInputPort,
  ) {}

  @Post()
  async create(
    @CurrentUser() userId: UserId,
    @Headers("idempotency-key") keyHeader: string | undefined,
    @Body(new ZodBodyPipe(CreateTripBody)) body: CreateTripBodyInput,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Trip> {
    const key = parseIdempotencyKey(keyHeader);
    const requestHash = computeRequestHash({
      operation: CREATE_TRIP_OPERATION,
      tripId: null,
      resourceId: null,
      body,
      ifMatch: null,
    });
    const result = await this.createTrip.execute({
      userId,
      key,
      requestHash,
      name: body.name,
      startsOn: body.startsOn,
      endsOn: body.endsOn,
    });
    return this.writeResult(response, result);
  }

  @Get()
  async list(
    @CurrentUser() userId: UserId,
    @Query(new ZodBodyPipe(ListTripsQueryParams)) query: ListTripsQueryInput,
    @Res({ passthrough: true }) response: Response,
  ): Promise<TripPage> {
    response.setHeader("Cache-Control", "private, no-store");
    return this.listTrips.execute({
      userId,
      status: query.status ?? null,
      cursor: query.cursor ?? null,
      limit: query.limit,
    });
  }

  @Get(":tripId")
  async get(
    @CurrentUser() userId: UserId,
    @Param(new ZodBodyPipe(GetTripParams)) params: TripParams,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Trip> {
    const trip = await this.getTrip.execute({
      userId,
      tripId: params.tripId,
    });
    response.setHeader("ETag", toStrongETag(trip.version));
    response.setHeader("Cache-Control", "private, no-store");
    return trip;
  }

  @Patch(":tripId/name")
  async rename(
    @CurrentUser() userId: UserId,
    @Param(new ZodBodyPipe(RenameTripParams)) params: TripParams,
    @Headers("idempotency-key") keyHeader: string | undefined,
    @Headers("if-match") ifMatchHeader: string | undefined,
    @Body(new ZodBodyPipe(RenameTripBody)) body: RenameTripBodyInput,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Trip> {
    const command = this.commandHeaders(keyHeader, ifMatchHeader);
    const requestHash = computeRequestHash({
      operation: RENAME_TRIP_OPERATION,
      tripId: params.tripId,
      resourceId: params.tripId,
      body,
      ifMatch: command.ifMatch,
    });
    const result = await this.renameTrip.execute({
      userId,
      tripId: params.tripId,
      key: command.key,
      ifMatch: command.ifMatch,
      requestHash,
      name: body.name,
    });
    return this.writeResult(response, result);
  }

  @Put(":tripId/period")
  async updatePeriod(
    @CurrentUser() userId: UserId,
    @Param(new ZodBodyPipe(UpdateTripPeriodParams)) params: TripParams,
    @Headers("idempotency-key") keyHeader: string | undefined,
    @Headers("if-match") ifMatchHeader: string | undefined,
    @Body(new ZodBodyPipe(UpdateTripPeriodBody)) body: UpdateTripPeriodBodyInput,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Trip> {
    const command = this.commandHeaders(keyHeader, ifMatchHeader);
    const requestHash = computeRequestHash({
      operation: CHANGE_TRIP_PERIOD_OPERATION,
      tripId: params.tripId,
      resourceId: params.tripId,
      body,
      ifMatch: command.ifMatch,
    });
    const result = await this.changeTripPeriod.execute({
      userId,
      tripId: params.tripId,
      key: command.key,
      ifMatch: command.ifMatch,
      requestHash,
      startsOn: body.startsOn,
      endsOn: body.endsOn,
    });
    return this.writeResult(response, result);
  }

  @Post(":tripId/start")
  async start(
    @CurrentUser() userId: UserId,
    @Param(new ZodBodyPipe(StartTripParams)) params: TripParams,
    @Headers("idempotency-key") keyHeader: string | undefined,
    @Headers("if-match") ifMatchHeader: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Trip> {
    const command = this.commandHeaders(keyHeader, ifMatchHeader);
    const requestHash = computeRequestHash({
      operation: START_TRIP_OPERATION,
      tripId: params.tripId,
      resourceId: params.tripId,
      body: null,
      ifMatch: command.ifMatch,
    });
    const result = await this.startTrip.execute({
      userId,
      tripId: params.tripId,
      key: command.key,
      ifMatch: command.ifMatch,
      requestHash,
    });
    return this.writeResult(response, result);
  }

  @Post(":tripId/finish")
  async finish(
    @CurrentUser() userId: UserId,
    @Param(new ZodBodyPipe(FinishTripParams)) params: TripParams,
    @Headers("idempotency-key") keyHeader: string | undefined,
    @Headers("if-match") ifMatchHeader: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Trip> {
    const command = this.commandHeaders(keyHeader, ifMatchHeader);
    const requestHash = computeRequestHash({
      operation: FINISH_TRIP_OPERATION,
      tripId: params.tripId,
      resourceId: params.tripId,
      body: null,
      ifMatch: command.ifMatch,
    });
    const result = await this.finishTrip.execute({
      userId,
      tripId: params.tripId,
      key: command.key,
      ifMatch: command.ifMatch,
      requestHash,
    });
    return this.writeResult(response, result);
  }

  private commandHeaders(
    keyHeader: string | undefined,
    ifMatchHeader: string | undefined,
  ): { key: IdempotencyKey; ifMatch: string } {
    return {
      key: parseIdempotencyKey(keyHeader),
      ifMatch: parseIfMatch(ifMatchHeader),
    };
  }

  private writeResult(response: Response, result: TripWriteResult): Trip {
    response.setHeader("ETag", toStrongETag(result.body.version));
    response.setHeader("Cache-Control", "private, no-store");
    response.status(result.httpStatus);
    return result.body;
  }
}
