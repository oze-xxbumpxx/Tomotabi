import { Module } from "@nestjs/common";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { PinoLogger } from "nestjs-pino";
import { CLOCK } from "../adapter/clock/clock.js";
import type { UnitOfWork } from "../adapter/transaction/unit-of-work.js";
import { SystemClock } from "../infrastructure/clock/system-clock.js";
import { getPool } from "../infrastructure/database/pool.js";
import { PgParticipantsQuery } from "../modules/identity/infrastructure/pg-participants.query.js";
import {
  PARTICIPANTS_FACTORY,
  type ParticipantsFactory,
  type ParticipantsPort,
} from "../modules/planning/adapter/outbound/participants.port.js";
import {
  HOME_BALANCE_FACTORY,
  type HomeBalanceFactory,
  type HomeBalancePort,
} from "../modules/planning/adapter/outbound/home-balance.port.js";
import {
  HOME_READ_UNIT_OF_WORK,
  type HomeReadUnitOfWork,
} from "../modules/planning/adapter/outbound/home-read.port.js";
import {
  HOME_RECORDS_FACTORY,
  type HomeRecordsFactory,
  type HomeRecordsPort,
} from "../modules/planning/adapter/outbound/home-records.port.js";
import {
  PLANNING_READ_PORT,
  type PlanningReadPort,
} from "../modules/planning/adapter/outbound/planning-read.port.js";
import {
  PLANNING_UNIT_OF_WORK,
  type PlanningWorkContext,
} from "../modules/planning/adapter/outbound/planning-work-context.js";
import {
  RECORD_HISTORY_FACTORY,
  type RecordHistoryFactory,
  type RecordHistoryPort,
} from "../modules/planning/adapter/outbound/record-history.port.js";
import {
  WRITE_LOG,
  type WriteLog,
} from "../modules/planning/adapter/outbound/write-log.port.js";
import { PgHomeReadUnitOfWork } from "../modules/planning/infrastructure/pg-home-read.unit-of-work.js";
import { PgPlanningRead } from "../modules/planning/infrastructure/pg-planning-read.js";
import { PgPlanningUnitOfWork } from "../modules/planning/infrastructure/pg-planning-unit-of-work.js";
import { PgHomeRecordsRead } from "../modules/record/infrastructure/pg-home-records-read.js";
import { PgRecordHistoryQuery } from "../modules/record/infrastructure/pg-record-history.query.js";
import { PgHomeBalanceRead } from "../modules/settlement/infrastructure/pg-home-balance-read.js";
import { NOTIFICATION_PUBLISHER } from "../modules/planning/adapter/outbound/notification-publisher.js";
import { AfterResponseNotificationPublisher } from "../modules/notification/infrastructure/after-response-notification-publisher.js";
import { NotificationCompositionModule } from "./notification-composition.module.js";

function useDatabase(): boolean {
  // 未設定と空文字はどちらも「DBなし」。foundation・identityと同じ判定に
  // そろえる（.env.exampleの`DATABASE_URL=`は空文字。差分4）。
  // DBなし起動ではGuardが先に503/401を返すため、これらの実装は呼ばれない。
  return Boolean(process.env.DATABASE_URL);
}

const missingDatabase = (): Promise<never> =>
  Promise.reject(new Error("DATABASE_URL is not set"));

/**
 * planningのportと、identity（許可リストの照会）・record（履歴の照会）・
 * infrastructure（時計・receipt・財務guard）の実装を結ぶ組み立て。
 */
@Module({
  imports: [NotificationCompositionModule],
  providers: [
    {
      provide: NOTIFICATION_PUBLISHER,
      useExisting: AfterResponseNotificationPublisher,
    },
    {
      provide: PARTICIPANTS_FACTORY,
      useFactory: (): ParticipantsFactory =>
        (db): ParticipantsPort =>
          new PgParticipantsQuery(db as NodePgDatabase),
    },
    {
      provide: RECORD_HISTORY_FACTORY,
      useFactory: (): RecordHistoryFactory =>
        (db): RecordHistoryPort =>
          new PgRecordHistoryQuery(db as NodePgDatabase),
    },
    {
      provide: PLANNING_UNIT_OF_WORK,
      useFactory: (
        participantsFactory: ParticipantsFactory,
        recordHistoryFactory: RecordHistoryFactory,
      ): UnitOfWork<PlanningWorkContext> =>
        useDatabase()
          ? new PgPlanningUnitOfWork(
              getPool(),
              participantsFactory,
              recordHistoryFactory,
            )
          : { run: missingDatabase },
      inject: [PARTICIPANTS_FACTORY, RECORD_HISTORY_FACTORY],
    },
    {
      provide: HOME_RECORDS_FACTORY,
      useFactory: (): HomeRecordsFactory =>
        (db): HomeRecordsPort =>
          new PgHomeRecordsRead(db as NodePgDatabase),
    },
    {
      provide: HOME_BALANCE_FACTORY,
      useFactory: (): HomeBalanceFactory =>
        (db): HomeBalancePort =>
          new PgHomeBalanceRead(db as NodePgDatabase),
    },
    {
      provide: HOME_READ_UNIT_OF_WORK,
      useFactory: (
        recordsFactory: HomeRecordsFactory,
        balanceFactory: HomeBalanceFactory,
      ): HomeReadUnitOfWork =>
        useDatabase()
          ? new PgHomeReadUnitOfWork(
              getPool(),
              recordsFactory,
              balanceFactory,
            )
          : { run: missingDatabase },
      inject: [HOME_RECORDS_FACTORY, HOME_BALANCE_FACTORY],
    },
    {
      provide: PLANNING_READ_PORT,
      useFactory: (): PlanningReadPort =>
        useDatabase()
          ? new PgPlanningRead(getPool())
          : {
              findTripForParticipant: missingDatabase,
              findTripAnchor: missingDatabase,
              listTripsForParticipant: missingDatabase,
              findPlanInTrip: missingDatabase,
              listPlansForDay: missingDatabase,
            },
    },
    { provide: CLOCK, useClass: SystemClock },
    {
      provide: WRITE_LOG,
      useFactory: (logger: PinoLogger): WriteLog => ({
        info: (entry) => logger.info(entry),
      }),
      inject: [PinoLogger],
    },
  ],
  exports: [
    // 送る処理のpublisher実装をrecord・settlementへも届けるため再輸出。
    NotificationCompositionModule,
    PARTICIPANTS_FACTORY,
    HOME_RECORDS_FACTORY,
    HOME_BALANCE_FACTORY,
    HOME_READ_UNIT_OF_WORK,
    PLANNING_UNIT_OF_WORK,
    PLANNING_READ_PORT,
    CLOCK,
    WRITE_LOG,
    NOTIFICATION_PUBLISHER,
  ],
})
export class PlanningCompositionModule {}
