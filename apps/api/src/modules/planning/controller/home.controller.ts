import { Controller, Get, Inject, Param, Res } from "@nestjs/common";
import type { Home } from "@tomotabi/contracts";
import type { Response } from "express";
import type { z as zod } from "zod";
import type { UserId } from "../../../common/domain/user-id";
import { CurrentUser } from "../../../common/guard/current-user.decorator";
import { ZodBodyPipe } from "../../../common/http/zod-body.pipe";
import { GetHomeParams } from "../../../generated/trips.zod";
import {
  GET_HOME_INPUT_PORT,
  type GetHomeInputPort,
} from "../adapter/inbound/get-home.input-port";

type HomeParams = zod.infer<typeof GetHomeParams>;

@Controller("trips")
export class HomeController {
  constructor(
    @Inject(GET_HOME_INPUT_PORT)
    private readonly getHome: GetHomeInputPort,
  ) {}

  @Get(":tripId/home")
  async home(
    @CurrentUser() userId: UserId,
    @Param(new ZodBodyPipe(GetHomeParams)) params: HomeParams,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Home> {
    response.setHeader("Cache-Control", "private, no-store");
    return this.getHome.execute({ userId, tripId: params.tripId });
  }
}
