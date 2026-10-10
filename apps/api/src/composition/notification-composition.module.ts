import { Module } from "@nestjs/common";
import { CLOCK, type Clock } from "../adapter/clock/clock";
import { SystemClock } from "../infrastructure/clock/system-clock";
import { getPool } from "../infrastructure/database/pool";
import {
  CLOSE_PUSH_SESSION_INPUT_PORT,
  type ClosePushSessionInputPort,
} from "../modules/notification/adapter/inbound/close-push-session.input-port";
import {
  NOTIFICATION_UNIT_OF_WORK,
  type NotificationUnitOfWork,
} from "../modules/notification/adapter/outbound/push-subscription.repository";
import {
  VAPID_KEYRING,
  type VapidKeyringPort,
} from "../modules/notification/adapter/outbound/vapid-keyring.port";
import { EnvVapidKeyring } from "../modules/notification/infrastructure/env-vapid-keyring";
import { PgNotificationUnitOfWork } from "../modules/notification/infrastructure/pg-notification-unit-of-work";
import { ClosePushSessionUseCase } from "../modules/notification/usecase/close-push-session.usecase";

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
      provide: CLOSE_PUSH_SESSION_INPUT_PORT,
      useFactory: (
        uow: NotificationUnitOfWork,
        clock: Clock,
      ): ClosePushSessionInputPort =>
        new ClosePushSessionUseCase(uow, clock),
      inject: [NOTIFICATION_UNIT_OF_WORK, CLOCK],
    },
    { provide: CLOCK, useClass: SystemClock },
  ],
  exports: [
    NOTIFICATION_UNIT_OF_WORK,
    VAPID_KEYRING,
    CLOSE_PUSH_SESSION_INPUT_PORT,
    CLOCK,
  ],
})
export class NotificationCompositionModule {}
