import { Module } from "@nestjs/common";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { UnitOfWork } from "../adapter/transaction/unit-of-work";
import { getPool } from "../infrastructure/database/pool";
import {
  FINANCE_UNIT_OF_WORK,
  type FinanceWorkContext,
} from "../modules/record/adapter/outbound/finance-work-context";
import {
  PLAN_ELIGIBILITY_FACTORY,
  type PlanEligibilityFactory,
  type PlanEligibilityPort,
} from "../modules/record/adapter/outbound/plan-eligibility.port";
import {
  PLAN_EVENT_UNIT_OF_WORK,
  type PlanEventWorkContext,
} from "../modules/record/adapter/outbound/plan-event-work-context";
import {
  RECORDS_READ_UNIT_OF_WORK,
  type RecordsReadUnitOfWork,
} from "../modules/record/adapter/outbound/records-read.port";
import { PgPlanEligibilityQuery } from "../modules/record/infrastructure/pg-plan-eligibility.query";
import { PgPlanEventUnitOfWork } from "../modules/record/infrastructure/pg-plan-event.unit-of-work";
import { PgRecordsReadUnitOfWork } from "../modules/record/infrastructure/pg-records-read.unit-of-work";
import { PgFinanceUnitOfWork } from "../modules/settlement/infrastructure/pg-finance-unit-of-work";
import { NOTIFICATION_PUBLISHER } from "../modules/record/adapter/outbound/notification-publisher";
import { AfterResponseNotificationPublisher } from "../modules/notification/infrastructure/after-response-notification-publisher";
import { PlanningCompositionModule } from "./planning-composition.module";

function useDatabase(): boolean {
  // planningと同じ判定（未設定と空文字はどちらも「DBなし」）。
  return Boolean(process.env.DATABASE_URL);
}

const missingDatabase = (): Promise<never> =>
  Promise.reject(new Error("DATABASE_URL is not set"));

/**
 * record（支払い）のportと財務のUnitOfWorkの実装を結ぶ組み立て。
 * 時計・receipt・書き込みログなどの共有の部品はplanningの組み立てが
 * そのまま提供する（PlanningCompositionModuleのexportsを使う）。
 */
@Module({
  imports: [PlanningCompositionModule],
  providers: [
    {
      provide: NOTIFICATION_PUBLISHER,
      useExisting: AfterResponseNotificationPublisher,
    },
    {
      provide: FINANCE_UNIT_OF_WORK,
      useFactory: (): UnitOfWork<FinanceWorkContext> =>
        useDatabase()
          ? new PgFinanceUnitOfWork(getPool())
          : { run: missingDatabase },
    },
    {
      provide: RECORDS_READ_UNIT_OF_WORK,
      useFactory: (): RecordsReadUnitOfWork =>
        useDatabase()
          ? new PgRecordsReadUnitOfWork(getPool())
          : { run: missingDatabase },
    },
    {
      // 達成・予約の書き込みが使う、予定を付けられる状態かの照会。
      // planningの予定の読み取りにつなぐ（予定行のロックも含めて同じ実装）。
      provide: PLAN_ELIGIBILITY_FACTORY,
      useFactory: (): PlanEligibilityFactory =>
        (db): PlanEligibilityPort =>
          new PgPlanEligibilityQuery(db as NodePgDatabase),
    },
    {
      provide: PLAN_EVENT_UNIT_OF_WORK,
      useFactory: (
        planEligibilityFactory: PlanEligibilityFactory,
      ): UnitOfWork<PlanEventWorkContext> =>
        useDatabase()
          ? new PgPlanEventUnitOfWork(getPool(), planEligibilityFactory)
          : { run: missingDatabase },
      inject: [PLAN_ELIGIBILITY_FACTORY],
    },
  ],
  // PlanningCompositionModuleを再輸出して、recordのUseCaseが時計・
  // 書き込みログを同じ実装で受け取れるようにする。
  exports: [
    PlanningCompositionModule,
    FINANCE_UNIT_OF_WORK,
    RECORDS_READ_UNIT_OF_WORK,
    PLAN_EVENT_UNIT_OF_WORK,
    NOTIFICATION_PUBLISHER,
  ],
})
export class RecordCompositionModule {}
