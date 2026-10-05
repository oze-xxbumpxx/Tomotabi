import {
  Controller,
  Get,
  Inject,
  Param,
  Query,
  Res,
} from "@nestjs/common";
import type { Records } from "@tomotabi/contracts";
import type { Response } from "express";
import type { z as zod } from "zod";
import type { UserId } from "../../../common/domain/user-id";
import { CurrentUser } from "../../../common/guard/current-user.decorator";
import { ZodBodyPipe } from "../../../common/http/zod-body.pipe";
import {
  ListRecordsParams,
  ListRecordsQueryParams,
} from "../../../generated/planning.zod";
import {
  LIST_RECORDS_INPUT_PORT,
  type ListRecordsInputPort,
} from "../adapter/inbound/list-records.input-port";

type ListParams = zod.infer<typeof ListRecordsParams>;
type ListQuery = zod.infer<typeof ListRecordsQueryParams>;

@Controller("trips")
export class RecordsController {
  constructor(
    @Inject(LIST_RECORDS_INPUT_PORT)
    private readonly listRecords: ListRecordsInputPort,
  ) {}

  @Get(":tripId/records")
  async list(
    @CurrentUser() userId: UserId,
    @Param(new ZodBodyPipe(ListRecordsParams)) params: ListParams,
    @Query() rawQuery: Record<string, unknown>,
    @Query(new ZodBodyPipe(ListRecordsQueryParams)) query: ListQuery,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Records> {
    const page = await this.listRecords.execute({
      userId,
      tripId: params.tripId,
      type: query.type ?? null,
      planId: query.planId ?? null,
      recordId: query.recordId ?? null,
      cursor: query.cursor ?? null,
      // zodの既定値20が適用されると「省略」と「20を明示」が区別できない。
      // recordIdとの併用を断つため、生のクエリでlimitの有無を見る（E-06）。
      limit: "limit" in rawQuery ? query.limit : null,
    });
    response.setHeader("Cache-Control", "private, no-store");
    return page;
  }
}
