import {
  Body,
  Controller,
  Headers,
  Inject,
  Param,
  Post,
  Res,
} from "@nestjs/common";
import type { Cancellation, PlanEvent } from "@tomotabi/contracts";
import type { Response } from "express";
import type { z as zod } from "zod";
import type { UserId } from "../../../common/domain/user-id";
import { CurrentUser } from "../../../common/guard/current-user.decorator";
import { parseIdempotencyKey } from "../../../common/http/idempotency-key";
import { computeRequestHash } from "../../../common/idempotency/command-receipt";
import { ZodBodyPipe } from "../../../common/http/zod-body.pipe";
import {
  CancelBookingParams,
  CreateBookingBody,
  CreateBookingParams,
} from "../../../generated/planning.zod";
import {
  CANCEL_PLAN_EVENT_INPUT_PORT,
  cancelPlanEventOperation,
  type CancelPlanEventInputPort,
} from "../adapter/inbound/cancel-plan-event.input-port";
import {
  CREATE_PLAN_EVENT_INPUT_PORT,
  createPlanEventOperation,
  type CreatePlanEventInputPort,
} from "../adapter/inbound/create-plan-event.input-port";

type CreateParams = zod.infer<typeof CreateBookingParams>;
type CreateBody = zod.infer<typeof CreateBookingBody>;
type CancelParams = zod.infer<typeof CancelBookingParams>;

@Controller("trips")
export class BookingsController {
  constructor(
    @Inject(CREATE_PLAN_EVENT_INPUT_PORT)
    private readonly createPlanEvent: CreatePlanEventInputPort,
    @Inject(CANCEL_PLAN_EVENT_INPUT_PORT)
    private readonly cancelPlanEvent: CancelPlanEventInputPort,
  ) {}

  @Post(":tripId/bookings")
  async create(
    @CurrentUser() userId: UserId,
    @Param(new ZodBodyPipe(CreateBookingParams)) params: CreateParams,
    @Headers("idempotency-key") keyHeader: string | undefined,
    @Body(new ZodBodyPipe(CreateBookingBody)) body: CreateBody,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PlanEvent> {
    const key = parseIdempotencyKey(keyHeader);
    const requestHash = computeRequestHash({
      operation: createPlanEventOperation("booking"),
      tripId: params.tripId,
      resourceId: null,
      body,
      ifMatch: null,
    });
    const result = await this.createPlanEvent.execute({
      userId,
      tripId: params.tripId,
      eventKind: "booking",
      planId: body.planId,
      key,
      requestHash,
    });
    response.setHeader("Cache-Control", "private, no-store");
    response.status(result.httpStatus);
    return result.body;
  }

  @Post(":tripId/bookings/:recordId/cancel")
  async cancel(
    @CurrentUser() userId: UserId,
    @Param(new ZodBodyPipe(CancelBookingParams)) params: CancelParams,
    @Headers("idempotency-key") keyHeader: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Cancellation> {
    const key = parseIdempotencyKey(keyHeader);
    const requestHash = computeRequestHash({
      operation: cancelPlanEventOperation("booking"),
      tripId: params.tripId,
      resourceId: params.recordId,
      body: null,
      ifMatch: null,
    });
    const result = await this.cancelPlanEvent.execute({
      userId,
      tripId: params.tripId,
      eventKind: "booking",
      recordId: params.recordId,
      key,
      requestHash,
    });
    response.setHeader("Cache-Control", "private, no-store");
    response.status(result.httpStatus);
    return result.body;
  }
}
