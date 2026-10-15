import {
  Controller,
  Get,
  Inject,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import type { Me } from "@tomotabi/contracts";
import type { Response } from "express";
import type { AuthenticatedRequest } from "../../../common/guard/authenticated-request.js";
import { CurrentUser } from "../../../common/guard/current-user.decorator.js";
import type { UserId } from "../../../common/domain/user-id.js";
import {
  GET_ME_INPUT_PORT,
  type GetMeInputPort,
} from "../adapter/inbound/get-me.input-port.js";

@Controller("me")
export class MeController {
  constructor(
    @Inject(GET_ME_INPUT_PORT)
    private readonly getMe: GetMeInputPort,
  ) {}

  @Get()
  async get(
    @CurrentUser() userId: UserId,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Me> {
    response.setHeader("Cache-Control", "private, no-store");
    const me = await this.getMe.execute(userId, request.sessionExpiresAt);
    if (me === null) {
      response.locals.code = "UNAUTHENTICATED";
      throw new UnauthorizedException({
        code: "UNAUTHENTICATED",
        message: "Authentication required",
      });
    }
    return me;
  }
}
