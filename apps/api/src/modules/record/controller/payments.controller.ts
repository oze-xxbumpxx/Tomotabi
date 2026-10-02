import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Res,
} from "@nestjs/common";
import type { Cancellation, Payment } from "@tomotabi/contracts";
import type { Response } from "express";
import type { z as zod } from "zod";
import type { UserId } from "../../../common/domain/user-id";
import { CurrentUser } from "../../../common/guard/current-user.decorator";
import {
  parseIdempotencyKey,
} from "../../../common/http/idempotency-key";
import { computeRequestHash } from "../../../common/idempotency/command-receipt";
import { ZodBodyPipe } from "../../../common/http/zod-body.pipe";
import {
  CancelPaymentParams,
  CreatePaymentBody,
  CreatePaymentParams,
  GetPaymentParams,
} from "../../../generated/finance.zod";
import {
  CANCEL_PAYMENT_INPUT_PORT,
  CANCEL_PAYMENT_OPERATION,
  type CancelPaymentInputPort,
} from "../adapter/inbound/cancel-payment.input-port";
import {
  CREATE_PAYMENT_INPUT_PORT,
  CREATE_PAYMENT_OPERATION,
  type CreatePaymentInputPort,
} from "../adapter/inbound/create-payment.input-port";
import {
  GET_PAYMENT_INPUT_PORT,
  type GetPaymentInputPort,
} from "../adapter/inbound/get-payment.input-port";

type CreatePaymentParamsInput = zod.infer<typeof CreatePaymentParams>;
type CreatePaymentBodyInput = zod.infer<typeof CreatePaymentBody>;
type PaymentParams = zod.infer<typeof GetPaymentParams>;
type CancelPaymentParamsInput = zod.infer<typeof CancelPaymentParams>;

@Controller("trips")
export class PaymentsController {
  constructor(
    @Inject(CREATE_PAYMENT_INPUT_PORT)
    private readonly createPayment: CreatePaymentInputPort,
    @Inject(GET_PAYMENT_INPUT_PORT)
    private readonly getPayment: GetPaymentInputPort,
    @Inject(CANCEL_PAYMENT_INPUT_PORT)
    private readonly cancelPayment: CancelPaymentInputPort,
  ) {}

  @Post(":tripId/payments")
  async create(
    @CurrentUser() userId: UserId,
    @Param(new ZodBodyPipe(CreatePaymentParams)) params: CreatePaymentParamsInput,
    @Headers("idempotency-key") keyHeader: string | undefined,
    @Body(new ZodBodyPipe(CreatePaymentBody)) body: CreatePaymentBodyInput,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Payment> {
    const key = parseIdempotencyKey(keyHeader);
    const requestHash = computeRequestHash({
      operation: CREATE_PAYMENT_OPERATION,
      tripId: params.tripId,
      resourceId: null,
      body,
      ifMatch: null,
    });
    const result = await this.createPayment.execute({
      userId,
      tripId: params.tripId,
      key,
      requestHash,
      amountYen: body.amountYen,
      payerUserId: body.payerUserId,
      allocations: body.allocations,
      label: body.label ?? null,
      planId: body.planId ?? null,
    });
    response.setHeader("Cache-Control", "private, no-store");
    response.status(result.httpStatus);
    return result.body;
  }

  @Get(":tripId/payments/:id")
  async get(
    @CurrentUser() userId: UserId,
    @Param(new ZodBodyPipe(GetPaymentParams)) params: PaymentParams,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Payment> {
    const payment = await this.getPayment.execute({
      userId,
      tripId: params.tripId,
      paymentId: params.id,
    });
    response.setHeader("Cache-Control", "private, no-store");
    return payment;
  }

  @Post(":tripId/payments/:id/cancel")
  async cancel(
    @CurrentUser() userId: UserId,
    @Param(new ZodBodyPipe(CancelPaymentParams)) params: CancelPaymentParamsInput,
    @Headers("idempotency-key") keyHeader: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Cancellation> {
    const key = parseIdempotencyKey(keyHeader);
    const requestHash = computeRequestHash({
      operation: CANCEL_PAYMENT_OPERATION,
      tripId: params.tripId,
      resourceId: params.id,
      body: null,
      ifMatch: null,
    });
    const result = await this.cancelPayment.execute({
      userId,
      tripId: params.tripId,
      paymentId: params.id,
      key,
      requestHash,
    });
    response.setHeader("Cache-Control", "private, no-store");
    response.status(result.httpStatus);
    return result.body;
  }
}
