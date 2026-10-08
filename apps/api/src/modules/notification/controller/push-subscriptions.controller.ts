import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Put,
  Req,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import type { z as zod } from "zod";
import type { UserId } from "../../../common/domain/user-id";
import type { AuthenticatedRequest } from "../../../common/guard/authenticated-request";
import { CurrentUser } from "../../../common/guard/current-user.decorator";
import { ZodBodyPipe } from "../../../common/http/zod-body.pipe";
import {
  DisablePushSubscriptionParams,
  RegisterPushSubscriptionBody,
} from "../../../generated/notifications.zod";
import { ApiError } from "../../../common/http/api-error";
import { endpointHasControlChar } from "../domain/push-endpoint";
import type { PushSubscriptionItem } from "../domain/push-subscription";
import {
  DISABLE_PUSH_SUBSCRIPTION_INPUT_PORT,
  type DisablePushSubscriptionInputPort,
} from "../adapter/inbound/disable-push-subscription.input-port";
import {
  GET_PUSH_CONFIG_INPUT_PORT,
  type GetPushConfigInputPort,
  type PushConfig,
} from "../adapter/inbound/get-push-config.input-port";
import {
  LIST_PUSH_SUBSCRIPTIONS_INPUT_PORT,
  type ListPushSubscriptionsInputPort,
  type PushSubscriptionList,
} from "../adapter/inbound/list-push-subscriptions.input-port";
import {
  PUT_PUSH_SUBSCRIPTION_INPUT_PORT,
  type PushRegistrationInput,
  type PutPushSubscriptionInputPort,
} from "../adapter/inbound/put-push-subscription.input-port";

type DisableParams = zod.infer<typeof DisablePushSubscriptionParams>;

const NO_STORE = "private, no-store";

/**
 * 購読のAPI（/api/me/push-*）。認証と許可はAPP_GUARDのSessionGuard、
 * PUT・DELETEのOriginの確認は同じくOriginGuardが行う。
 * 応答はCache-Control: private, no-store（ほかのAPIと同じ）。
 * 宛先と鍵は応答にもログにも出さない。
 */
@Controller("me")
export class PushSubscriptionsController {
  constructor(
    @Inject(GET_PUSH_CONFIG_INPUT_PORT)
    private readonly getPushConfig: GetPushConfigInputPort,
    @Inject(LIST_PUSH_SUBSCRIPTIONS_INPUT_PORT)
    private readonly listPushSubscriptions: ListPushSubscriptionsInputPort,
    @Inject(PUT_PUSH_SUBSCRIPTION_INPUT_PORT)
    private readonly putPushSubscription: PutPushSubscriptionInputPort,
    @Inject(DISABLE_PUSH_SUBSCRIPTION_INPUT_PORT)
    private readonly disablePushSubscription: DisablePushSubscriptionInputPort,
  ) {}

  @Get("push-config")
  async config(
    @Res({ passthrough: true }) response: Response,
  ): Promise<PushConfig> {
    response.setHeader("Cache-Control", NO_STORE);
    return this.getPushConfig.execute();
  }

  @Get("push-subscriptions")
  async list(
    @CurrentUser() userId: UserId,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PushSubscriptionList> {
    response.setHeader("Cache-Control", NO_STORE);
    return this.listPushSubscriptions.execute(userId, request.sessionId);
  }

  @Put("push-subscriptions")
  async put(
    @CurrentUser() userId: UserId,
    @Req() request: AuthenticatedRequest,
    @Body() rawBody: unknown,
    @Body(new ZodBodyPipe(RegisterPushSubscriptionBody))
    body: PushRegistrationInput,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PushSubscriptionItem> {
    response.setHeader("Cache-Control", NO_STORE);
    // zod.url()は解析でタブ・CR・LFを取り除いた正規化した値を返すため、
    // 生の本文の宛先に残る制御文字の確認はUseCaseの前のここで行う。
    const rawEndpoint = (rawBody as { endpoint?: unknown }).endpoint;
    if (
      typeof rawEndpoint === "string" &&
      endpointHasControlChar(rawEndpoint)
    ) {
      throw new ApiError({
        code: "UNSUPPORTED_PUSH_SERVICE",
        status: 422,
        message: "This push endpoint is not supported",
      });
    }
    return this.putPushSubscription.execute(
      userId,
      request.sessionId,
      body,
    );
  }

  @Delete("push-subscriptions/:id")
  async disable(
    @CurrentUser() userId: UserId,
    @Param(new ZodBodyPipe(DisablePushSubscriptionParams))
    params: DisableParams,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    response.setHeader("Cache-Control", NO_STORE);
    response.status(204);
    await this.disablePushSubscription.execute(userId, params.id);
  }
}
