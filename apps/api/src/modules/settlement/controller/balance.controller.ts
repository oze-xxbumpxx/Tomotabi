import {
  Controller,
  Get,
  Inject,
  Param,
  Res,
} from "@nestjs/common";
import type { Balance } from "@tomotabi/contracts";
import type { Response } from "express";
import type { z as zod } from "zod";
import type { UserId } from "../../../common/domain/user-id";
import { CurrentUser } from "../../../common/guard/current-user.decorator";
import { ZodBodyPipe } from "../../../common/http/zod-body.pipe";
import { GetBalanceParams } from "../../../generated/finance.zod";
import {
  GET_BALANCE_INPUT_PORT,
  type GetBalanceInputPort,
} from "../adapter/inbound/get-balance.input-port";

type BalanceParams = zod.infer<typeof GetBalanceParams>;

@Controller("trips")
export class BalanceController {
  constructor(
    @Inject(GET_BALANCE_INPUT_PORT)
    private readonly getBalance: GetBalanceInputPort,
  ) {}

  @Get(":tripId/balance")
  async get(
    @CurrentUser() userId: UserId,
    @Param(new ZodBodyPipe(GetBalanceParams)) params: BalanceParams,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Balance> {
    const balance = await this.getBalance.execute({
      userId,
      tripId: params.tripId,
    });
    response.setHeader("Cache-Control", "private, no-store");
    return balance;
  }
}
