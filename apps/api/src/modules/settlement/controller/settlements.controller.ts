import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Query,
  Res,
} from "@nestjs/common";
import type {
  Cancellation,
  Settlement,
  SettlementPage,
} from "@tomotabi/contracts";
import type { Response } from "express";
import type { z as zod } from "zod";
import type { UserId } from "../../../common/domain/user-id";
import { CurrentUser } from "../../../common/guard/current-user.decorator";
import { parseIdempotencyKey } from "../../../common/http/idempotency-key";
import { computeRequestHash } from "../../../common/idempotency/command-receipt";
import { ZodBodyPipe } from "../../../common/http/zod-body.pipe";
import {
  CancelSettlementParams,
  CompleteSettlementBody,
  CompleteSettlementParams,
  GetSettlementParams,
  ListSettlementsParams,
  ListSettlementsQueryParams,
} from "../../../generated/finance.zod";
import {
  CANCEL_SETTLEMENT_INPUT_PORT,
  CANCEL_SETTLEMENT_OPERATION,
  type CancelSettlementInputPort,
} from "../adapter/inbound/cancel-settlement.input-port";
import {
  COMPLETE_SETTLEMENT_INPUT_PORT,
  COMPLETE_SETTLEMENT_OPERATION,
  type CompleteSettlementInputPort,
} from "../adapter/inbound/complete-settlement.input-port";
import {
  GET_SETTLEMENT_INPUT_PORT,
  type GetSettlementInputPort,
} from "../adapter/inbound/get-settlement.input-port";
import {
  LIST_SETTLEMENTS_INPUT_PORT,
  type ListSettlementsInputPort,
} from "../adapter/inbound/list-settlements.input-port";

type CompleteParams = zod.infer<typeof CompleteSettlementParams>;
type CompleteBody = zod.infer<typeof CompleteSettlementBody>;
type ListParams = zod.infer<typeof ListSettlementsParams>;
type ListQuery = zod.infer<typeof ListSettlementsQueryParams>;
type SettlementParams = zod.infer<typeof GetSettlementParams>;
type CancelParams = zod.infer<typeof CancelSettlementParams>;

@Controller("trips")
export class SettlementsController {
  constructor(
    @Inject(COMPLETE_SETTLEMENT_INPUT_PORT)
    private readonly completeSettlement: CompleteSettlementInputPort,
    @Inject(LIST_SETTLEMENTS_INPUT_PORT)
    private readonly listSettlements: ListSettlementsInputPort,
    @Inject(GET_SETTLEMENT_INPUT_PORT)
    private readonly getSettlement: GetSettlementInputPort,
    @Inject(CANCEL_SETTLEMENT_INPUT_PORT)
    private readonly cancelSettlement: CancelSettlementInputPort,
  ) {}

  @Post(":tripId/settlements")
  async complete(
    @CurrentUser() userId: UserId,
    @Param(new ZodBodyPipe(CompleteSettlementParams)) params: CompleteParams,
    @Body(new ZodBodyPipe(CompleteSettlementBody)) body: CompleteBody,
    @Headers("idempotency-key") keyHeader: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Settlement> {
    const key = parseIdempotencyKey(keyHeader);
    const requestHash = computeRequestHash({
      operation: COMPLETE_SETTLEMENT_OPERATION,
      tripId: params.tripId,
      resourceId: body.previewId,
      body,
      ifMatch: null,
    });
    const result = await this.completeSettlement.execute({
      userId,
      tripId: params.tripId,
      key,
      requestHash,
      previewId: body.previewId,
      completionKind: body.completionKind,
      acknowledgedCancellationPaymentIds:
        body.acknowledgedCancellationPaymentIds,
    });
    response.setHeader("Cache-Control", "private, no-store");
    response.status(result.httpStatus);
    return result.body;
  }

  @Get(":tripId/settlements")
  async list(
    @CurrentUser() userId: UserId,
    @Param(new ZodBodyPipe(ListSettlementsParams)) params: ListParams,
    @Query(new ZodBodyPipe(ListSettlementsQueryParams)) query: ListQuery,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SettlementPage> {
    const page = await this.listSettlements.execute({
      userId,
      tripId: params.tripId,
      cursor: query.cursor ?? null,
      limit: query.limit,
    });
    response.setHeader("Cache-Control", "private, no-store");
    return page;
  }

  @Get(":tripId/settlements/:id")
  async get(
    @CurrentUser() userId: UserId,
    @Param(new ZodBodyPipe(GetSettlementParams)) params: SettlementParams,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Settlement> {
    const settlement = await this.getSettlement.execute({
      userId,
      tripId: params.tripId,
      settlementId: params.id,
    });
    response.setHeader("Cache-Control", "private, no-store");
    return settlement;
  }

  @Post(":tripId/settlements/:id/cancel")
  async cancel(
    @CurrentUser() userId: UserId,
    @Param(new ZodBodyPipe(CancelSettlementParams)) params: CancelParams,
    @Headers("idempotency-key") keyHeader: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Cancellation> {
    const key = parseIdempotencyKey(keyHeader);
    const requestHash = computeRequestHash({
      operation: CANCEL_SETTLEMENT_OPERATION,
      tripId: params.tripId,
      resourceId: params.id,
      body: null,
      ifMatch: null,
    });
    const result = await this.cancelSettlement.execute({
      userId,
      tripId: params.tripId,
      settlementId: params.id,
      key,
      requestHash,
    });
    response.setHeader("Cache-Control", "private, no-store");
    response.status(result.httpStatus);
    return result.body;
  }
}
