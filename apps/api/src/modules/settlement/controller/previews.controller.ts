import {
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
  Preview,
  PreviewPage,
} from "@tomotabi/contracts";
import type { Response } from "express";
import type { z as zod } from "zod";
import type { UserId } from "../../../common/domain/user-id";
import { CurrentUser } from "../../../common/guard/current-user.decorator";
import { parseIdempotencyKey } from "../../../common/http/idempotency-key";
import { computeRequestHash } from "../../../common/idempotency/command-receipt";
import { ZodBodyPipe } from "../../../common/http/zod-body.pipe";
import {
  CreateSettlementPreviewParams,
  GetSettlementPreviewParams,
  ListSettlementPreviewsParams,
  ListSettlementPreviewsQueryParams,
} from "../../../generated/finance.zod";
import {
  CREATE_PREVIEW_INPUT_PORT,
  CREATE_PREVIEW_OPERATION,
  type CreatePreviewInputPort,
} from "../adapter/inbound/create-preview.input-port";
import {
  GET_PREVIEW_INPUT_PORT,
  type GetPreviewInputPort,
} from "../adapter/inbound/get-preview.input-port";
import {
  LIST_PREVIEWS_INPUT_PORT,
  type ListPreviewsInputPort,
} from "../adapter/inbound/list-previews.input-port";

type PreviewParams = zod.infer<typeof CreateSettlementPreviewParams>;
type ListPreviewsParamsInput = zod.infer<typeof ListSettlementPreviewsParams>;
type ListPreviewsQueryInput = zod.infer<
  typeof ListSettlementPreviewsQueryParams
>;
type PreviewIdParams = zod.infer<typeof GetSettlementPreviewParams>;

@Controller("trips")
export class PreviewsController {
  constructor(
    @Inject(CREATE_PREVIEW_INPUT_PORT)
    private readonly createPreview: CreatePreviewInputPort,
    @Inject(LIST_PREVIEWS_INPUT_PORT)
    private readonly listPreviews: ListPreviewsInputPort,
    @Inject(GET_PREVIEW_INPUT_PORT)
    private readonly getPreview: GetPreviewInputPort,
  ) {}

  @Post(":tripId/settlement-previews")
  async create(
    @CurrentUser() userId: UserId,
    @Param(new ZodBodyPipe(CreateSettlementPreviewParams))
    params: PreviewParams,
    @Headers("idempotency-key") keyHeader: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Preview> {
    const key = parseIdempotencyKey(keyHeader);
    const requestHash = computeRequestHash({
      operation: CREATE_PREVIEW_OPERATION,
      tripId: params.tripId,
      resourceId: null,
      body: null,
      ifMatch: null,
    });
    const result = await this.createPreview.execute({
      userId,
      tripId: params.tripId,
      key,
      requestHash,
    });
    response.setHeader("Cache-Control", "private, no-store");
    response.status(result.httpStatus);
    return result.body;
  }

  @Get(":tripId/settlement-previews")
  async list(
    @CurrentUser() userId: UserId,
    @Param(new ZodBodyPipe(ListSettlementPreviewsParams))
    params: ListPreviewsParamsInput,
    @Query(new ZodBodyPipe(ListSettlementPreviewsQueryParams))
    query: ListPreviewsQueryInput,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PreviewPage> {
    const page = await this.listPreviews.execute({
      userId,
      tripId: params.tripId,
      status: query.status,
      cursor: query.cursor,
      limit: query.limit,
    });
    response.setHeader("Cache-Control", "private, no-store");
    return page;
  }

  @Get(":tripId/settlement-previews/:id")
  async get(
    @CurrentUser() userId: UserId,
    @Param(new ZodBodyPipe(GetSettlementPreviewParams))
    params: PreviewIdParams,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Preview> {
    const preview = await this.getPreview.execute({
      userId,
      tripId: params.tripId,
      previewId: params.id,
    });
    response.setHeader("Cache-Control", "private, no-store");
    return preview;
  }
}
