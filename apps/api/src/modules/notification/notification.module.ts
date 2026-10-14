import { Module } from "@nestjs/common";
import { CLOCK, type Clock } from "../../adapter/clock/clock.js";
import { NotificationCompositionModule } from "../../composition/notification-composition.module.js";
import {
  DISABLE_PUSH_SUBSCRIPTION_INPUT_PORT,
  type DisablePushSubscriptionInputPort,
} from "./adapter/inbound/disable-push-subscription.input-port.js";
import {
  GET_PUSH_CONFIG_INPUT_PORT,
  type GetPushConfigInputPort,
} from "./adapter/inbound/get-push-config.input-port.js";
import {
  LIST_PUSH_SUBSCRIPTIONS_INPUT_PORT,
  type ListPushSubscriptionsInputPort,
} from "./adapter/inbound/list-push-subscriptions.input-port.js";
import {
  PUT_PUSH_SUBSCRIPTION_INPUT_PORT,
  type PutPushSubscriptionInputPort,
} from "./adapter/inbound/put-push-subscription.input-port.js";
import {
  NOTIFICATION_UNIT_OF_WORK,
  type NotificationUnitOfWork,
} from "./adapter/outbound/push-subscription.repository.js";
import {
  VAPID_KEYRING,
  type VapidKeyringPort,
} from "./adapter/outbound/vapid-keyring.port.js";
import { PushSubscriptionsController } from "./controller/push-subscriptions.controller.js";
import { DisablePushSubscriptionUseCase } from "./usecase/disable-push-subscription.usecase.js";
import { GetPushConfigUseCase } from "./usecase/get-push-config.usecase.js";
import { ListPushSubscriptionsUseCase } from "./usecase/list-push-subscriptions.usecase.js";
import { PutPushSubscriptionUseCase } from "./usecase/put-push-subscription.usecase.js";

@Module({
  imports: [NotificationCompositionModule],
  controllers: [PushSubscriptionsController],
  providers: [
    {
      provide: GET_PUSH_CONFIG_INPUT_PORT,
      useFactory: (keyring: VapidKeyringPort): GetPushConfigInputPort =>
        new GetPushConfigUseCase(keyring),
      inject: [VAPID_KEYRING],
    },
    {
      provide: LIST_PUSH_SUBSCRIPTIONS_INPUT_PORT,
      useFactory: (
        uow: NotificationUnitOfWork,
        keyring: VapidKeyringPort,
      ): ListPushSubscriptionsInputPort =>
        new ListPushSubscriptionsUseCase(uow, keyring),
      inject: [NOTIFICATION_UNIT_OF_WORK, VAPID_KEYRING],
    },
    {
      provide: PUT_PUSH_SUBSCRIPTION_INPUT_PORT,
      useFactory: (
        uow: NotificationUnitOfWork,
        keyring: VapidKeyringPort,
        clock: Clock,
      ): PutPushSubscriptionInputPort =>
        new PutPushSubscriptionUseCase(uow, keyring, clock),
      inject: [NOTIFICATION_UNIT_OF_WORK, VAPID_KEYRING, CLOCK],
    },
    {
      provide: DISABLE_PUSH_SUBSCRIPTION_INPUT_PORT,
      useFactory: (
        uow: NotificationUnitOfWork,
        clock: Clock,
      ): DisablePushSubscriptionInputPort =>
        new DisablePushSubscriptionUseCase(uow, clock),
      inject: [NOTIFICATION_UNIT_OF_WORK, CLOCK],
    },
  ],
})
export class NotificationModule {}
