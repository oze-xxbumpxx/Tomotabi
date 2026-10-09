import { Module } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";
import {
  AFTER_RESPONSE,
  type AfterResponse,
} from "../adapter/after-response/after-response";
import { CLOCK, type Clock } from "../adapter/clock/clock";
import { InProcessAfterResponse } from "../infrastructure/after-response/in-process-after-response";
import { SystemClock } from "../infrastructure/clock/system-clock";
import { getPool } from "../infrastructure/database/pool";
import {
  DISPATCH_LOG,
  type DispatchLog,
} from "../modules/notification/adapter/outbound/dispatch-log.port";
import {
  NOTIFICATION_DISPATCH_STORE,
  type NotificationDispatchStore,
} from "../modules/notification/adapter/outbound/notification-dispatch-store";
import {
  NOTIFICATION_UNIT_OF_WORK,
  type NotificationUnitOfWork,
} from "../modules/notification/adapter/outbound/push-subscription.repository";
import {
  PUSH_SENDER,
  type PushSender,
} from "../modules/notification/adapter/outbound/push-sender";
import {
  PUSH_TRANSPORT,
  type PushTransport,
} from "../modules/notification/adapter/outbound/push-transport";
import {
  VAPID_KEYRING,
  type VapidKeyringPort,
} from "../modules/notification/adapter/outbound/vapid-keyring.port";
import { AfterResponseNotificationPublisher } from "../modules/notification/infrastructure/after-response-notification-publisher";
import { EnvVapidKeyring } from "../modules/notification/infrastructure/env-vapid-keyring";
import { HttpsPushTransport } from "../modules/notification/infrastructure/https-push-transport";
import { PgNotificationDispatchStore } from "../modules/notification/infrastructure/pg-notification-dispatch-store";
import { PgNotificationUnitOfWork } from "../modules/notification/infrastructure/pg-notification-unit-of-work";
import { WebPushSender } from "../modules/notification/infrastructure/web-push-sender";
import { DispatchNotificationUseCase } from "../modules/notification/usecase/dispatch-notification.usecase";

function useDatabase(): boolean {
  // planning/recordと同じ判定（未設定と空文字はどちらも「DBなし」）。
  return Boolean(process.env.DATABASE_URL);
}

const missingDatabase = (): Promise<never> =>
  Promise.reject(new Error("DATABASE_URL is not configured"));

/**
 * notificationのoutbound（DB・環境変数の鍵束）をつなぐcomposition。
 * DBが無い環境では呼んだときだけ失敗する差し替えを渡す。
 */
@Module({
  providers: [
    {
      provide: NOTIFICATION_UNIT_OF_WORK,
      useFactory: (): NotificationUnitOfWork =>
        useDatabase()
          ? new PgNotificationUnitOfWork(getPool())
          : { run: missingDatabase },
    },
    {
      provide: VAPID_KEYRING,
      useFactory: (): VapidKeyringPort => EnvVapidKeyring.fromEnv(),
    },
    {
      provide: NOTIFICATION_DISPATCH_STORE,
      useFactory: (): NotificationDispatchStore =>
        useDatabase()
          ? new PgNotificationDispatchStore(getPool())
          : {
              readDispatchContext: missingDatabase,
              disableIfSameRevision: missingDatabase,
            },
    },
    { provide: PUSH_TRANSPORT, useClass: HttpsPushTransport },
    {
      provide: PUSH_SENDER,
      useFactory: (transport: PushTransport): PushSender =>
        new WebPushSender(transport),
      inject: [PUSH_TRANSPORT],
    },
    {
      provide: AFTER_RESPONSE,
      useFactory: (logger: PinoLogger): AfterResponse =>
        new InProcessAfterResponse((entry) => logger.warn(entry)),
      inject: [PinoLogger],
    },
    {
      provide: DISPATCH_LOG,
      useFactory: (logger: PinoLogger): DispatchLog => ({
        info: (entry) => logger.info(entry),
        warn: (entry) => logger.warn(entry),
      }),
      inject: [PinoLogger],
    },
    {
      provide: DispatchNotificationUseCase,
      useFactory: (
        store: NotificationDispatchStore,
        keyring: VapidKeyringPort,
        sender: PushSender,
        clock: Clock,
        log: DispatchLog,
      ): DispatchNotificationUseCase =>
        new DispatchNotificationUseCase(store, keyring, sender, clock, log),
      inject: [
        NOTIFICATION_DISPATCH_STORE,
        VAPID_KEYRING,
        PUSH_SENDER,
        CLOCK,
        DISPATCH_LOG,
      ],
    },
    {
      provide: AfterResponseNotificationPublisher,
      useFactory: (
        afterResponse: AfterResponse,
        dispatch: DispatchNotificationUseCase,
        logger: PinoLogger,
      ): AfterResponseNotificationPublisher =>
        new AfterResponseNotificationPublisher(afterResponse, dispatch, (entry) =>
          logger.warn(entry),
        ),
      inject: [AFTER_RESPONSE, DispatchNotificationUseCase, PinoLogger],
    },
    { provide: CLOCK, useClass: SystemClock },
  ],
  exports: [
    NOTIFICATION_UNIT_OF_WORK,
    VAPID_KEYRING,
    CLOCK,
    AFTER_RESPONSE,
    PUSH_SENDER,
    PUSH_TRANSPORT,
    NOTIFICATION_DISPATCH_STORE,
    DispatchNotificationUseCase,
    AfterResponseNotificationPublisher,
  ],
})
export class NotificationCompositionModule {}
