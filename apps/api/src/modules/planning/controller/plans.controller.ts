import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from "@nestjs/common";
import type { Itinerary, Plan } from "@tomotabi/contracts";
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
  CancelPlanParams,
  CreatePlanBody,
  CreatePlanParams,
  GetItineraryParams,
  GetItineraryQueryParams,
  GetPlanParams,
  MovePlanBody,
  MovePlanParams,
  UpdatePlanBody,
  UpdatePlanParams,
} from "../../../generated/planning.zod";
import {
  CANCEL_PLAN_INPUT_PORT,
  CANCEL_PLAN_OPERATION,
  type CancelPlanInputPort,
} from "../adapter/inbound/cancel-plan.input-port";
import {
  CREATE_PLAN_INPUT_PORT,
  CREATE_PLAN_OPERATION,
  type CreatePlanInputPort,
} from "../adapter/inbound/create-plan.input-port";
import {
  GET_ITINERARY_INPUT_PORT,
  type GetItineraryInputPort,
} from "../adapter/inbound/get-itinerary.input-port";
import {
  GET_PLAN_INPUT_PORT,
  type GetPlanInputPort,
} from "../adapter/inbound/get-plan.input-port";
import {
  MOVE_PLAN_INPUT_PORT,
  MOVE_PLAN_OPERATION,
  type MovePlanInputPort,
} from "../adapter/inbound/move-plan.input-port";
import type { PlanWriteResult } from "../adapter/inbound/plan-write.result";
import {
  UPDATE_PLAN_INPUT_PORT,
  UPDATE_PLAN_OPERATION,
  type UpdatePlanInputPort,
} from "../adapter/inbound/update-plan.input-port";

type TripParams = zod.infer<typeof CreatePlanParams>;
type PlanParams = zod.infer<typeof GetPlanParams>;
type CreatePlanBodyInput = zod.infer<typeof CreatePlanBody>;
type UpdatePlanBodyInput = zod.infer<typeof UpdatePlanBody>;
type MovePlanBodyInput = zod.infer<typeof MovePlanBody>;
type GetItineraryQueryInput = zod.infer<typeof GetItineraryQueryParams>;

@Controller("trips")
export class PlansController {
  constructor(
    @Inject(GET_ITINERARY_INPUT_PORT)
    private readonly getItinerary: GetItineraryInputPort,
    @Inject(CREATE_PLAN_INPUT_PORT)
    private readonly createPlan: CreatePlanInputPort,
    @Inject(GET_PLAN_INPUT_PORT)
    private readonly getPlan: GetPlanInputPort,
    @Inject(UPDATE_PLAN_INPUT_PORT)
    private readonly updatePlan: UpdatePlanInputPort,
    @Inject(MOVE_PLAN_INPUT_PORT)
    private readonly movePlan: MovePlanInputPort,
    @Inject(CANCEL_PLAN_INPUT_PORT)
    private readonly cancelPlan: CancelPlanInputPort,
  ) {}

  @Get(":tripId/itinerary")
  async itinerary(
    @CurrentUser() userId: UserId,
    @Param(new ZodBodyPipe(GetItineraryParams)) params: TripParams,
    @Query(new ZodBodyPipe(GetItineraryQueryParams))
    query: GetItineraryQueryInput,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Itinerary> {
    response.setHeader("Cache-Control", "private, no-store");
    return this.getItinerary.execute({
      userId,
      tripId: params.tripId,
      date: query.date ?? null,
    });
  }

  @Post(":tripId/plans")
  async create(
    @CurrentUser() userId: UserId,
    @Param(new ZodBodyPipe(CreatePlanParams)) params: TripParams,
    @Headers("idempotency-key") keyHeader: string | undefined,
    @Body(new ZodBodyPipe(CreatePlanBody)) body: CreatePlanBodyInput,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Plan> {
    const key = parseIdempotencyKey(keyHeader);
    const requestHash = computeRequestHash({
      operation: CREATE_PLAN_OPERATION,
      tripId: params.tripId,
      resourceId: null,
      body,
      ifMatch: null,
    });
    const result = await this.createPlan.execute({
      userId,
      tripId: params.tripId,
      key,
      requestHash,
      name: body.name,
      kind: body.kind,
      date: body.date,
      time: body.time ?? null,
      memo: body.memo ?? null,
    });
    return this.writeResult(response, result);
  }

  @Get(":tripId/plans/:planId")
  async get(
    @CurrentUser() userId: UserId,
    @Param(new ZodBodyPipe(GetPlanParams)) params: PlanParams,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Plan> {
    const plan = await this.getPlan.execute({
      userId,
      tripId: params.tripId,
      planId: params.planId,
    });
    response.setHeader("ETag", toStrongETag(plan.version));
    response.setHeader("Cache-Control", "private, no-store");
    return plan;
  }

  @Patch(":tripId/plans/:planId")
  async update(
    @CurrentUser() userId: UserId,
    @Param(new ZodBodyPipe(UpdatePlanParams)) params: PlanParams,
    @Headers("idempotency-key") keyHeader: string | undefined,
    @Headers("if-match") ifMatchHeader: string | undefined,
    @Body(
      new ZodBodyPipe(UpdatePlanBody, { nonEmptyObject: true }),
    )
    body: UpdatePlanBodyInput,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Plan> {
    const command = this.commandHeaders(keyHeader, ifMatchHeader);
    const requestHash = computeRequestHash({
      operation: UPDATE_PLAN_OPERATION,
      tripId: params.tripId,
      resourceId: params.planId,
      body,
      ifMatch: command.ifMatch,
    });
    const result = await this.updatePlan.execute({
      userId,
      tripId: params.tripId,
      planId: params.planId,
      key: command.key,
      ifMatch: command.ifMatch,
      requestHash,
      name: body.name,
      kind: body.kind,
      time: body.time,
      memo: body.memo,
    });
    return this.writeResult(response, result);
  }

  @Post(":tripId/plans/:planId/move")
  async move(
    @CurrentUser() userId: UserId,
    @Param(new ZodBodyPipe(MovePlanParams)) params: PlanParams,
    @Headers("idempotency-key") keyHeader: string | undefined,
    @Headers("if-match") ifMatchHeader: string | undefined,
    @Body(new ZodBodyPipe(MovePlanBody)) body: MovePlanBodyInput,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Plan> {
    const command = this.commandHeaders(keyHeader, ifMatchHeader);
    const requestHash = computeRequestHash({
      operation: MOVE_PLAN_OPERATION,
      tripId: params.tripId,
      resourceId: params.planId,
      body,
      ifMatch: command.ifMatch,
    });
    const result = await this.movePlan.execute({
      userId,
      tripId: params.tripId,
      planId: params.planId,
      key: command.key,
      ifMatch: command.ifMatch,
      requestHash,
      date: body.date,
    });
    return this.writeResult(response, result);
  }

  @Post(":tripId/plans/:planId/cancel")
  async cancel(
    @CurrentUser() userId: UserId,
    @Param(new ZodBodyPipe(CancelPlanParams)) params: PlanParams,
    @Headers("idempotency-key") keyHeader: string | undefined,
    @Headers("if-match") ifMatchHeader: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Plan> {
    const command = this.commandHeaders(keyHeader, ifMatchHeader);
    const requestHash = computeRequestHash({
      operation: CANCEL_PLAN_OPERATION,
      tripId: params.tripId,
      resourceId: params.planId,
      body: null,
      ifMatch: command.ifMatch,
    });
    const result = await this.cancelPlan.execute({
      userId,
      tripId: params.tripId,
      planId: params.planId,
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

  private writeResult(response: Response, result: PlanWriteResult): Plan {
    response.setHeader("ETag", toStrongETag(result.body.version));
    response.setHeader("Cache-Control", "private, no-store");
    response.status(result.httpStatus);
    return result.body;
  }
}
