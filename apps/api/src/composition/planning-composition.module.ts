import { Module } from "@nestjs/common";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { PinoLogger } from "nestjs-pino";
import { CLOCK } from "../adapter/clock/clock";
import type { UnitOfWork } from "../adapter/transaction/unit-of-work";
import { SystemClock } from "../infrastructure/clock/system-clock";
import { getPool } from "../infrastructure/database/pool";
import { PgParticipantsQuery } from "../modules/identity/infrastructure/pg-participants.query";
import {
  PARTICIPANTS_FACTORY,
  type ParticipantsFactory,
  type ParticipantsPort,
} from "../modules/planning/adapter/outbound/participants.port";
import {
  PLANNING_READ_PORT,
  type PlanningReadPort,
} from "../modules/planning/adapter/outbound/planning-read.port";
import {
  PLANNING_UNIT_OF_WORK,
  type PlanningWorkContext,
} from "../modules/planning/adapter/outbound/planning-work-context";
import {
  WRITE_LOG,
  type WriteLog,
} from "../modules/planning/adapter/outbound/write-log.port";
import { PgPlanningRead } from "../modules/planning/infrastructure/pg-planning-read";
import { PgPlanningUnitOfWork } from "../modules/planning/infrastructure/pg-planning-unit-of-work";

function useDatabase(): boolean {
  // 未設定と空文字はどちらも「DB なし」。foundation・identity と同じ判定に
  // そろえる（.env.example の `DATABASE_URL=` は空文字。差分 4）。
  // DB なし起動では Guard が先に 503/401 を返すため、これらの実装は呼ばれない。
  return Boolean(process.env.DATABASE_URL);
}

const missingDatabase = (): Promise<never> =>
  Promise.reject(new Error("DATABASE_URL is not set"));

/**
 * planning の port と、identity（許可リストの照会）・infrastructure（時計・
 * receipt・財務 guard）の実装を結ぶ組み立て。M2-b で record の履歴照会もここに足す。
 */
@Module({
  providers: [
    {
      provide: PARTICIPANTS_FACTORY,
      useFactory: (): ParticipantsFactory =>
        (db): ParticipantsPort =>
          new PgParticipantsQuery(db as NodePgDatabase),
    },
    {
      provide: PLANNING_UNIT_OF_WORK,
      useFactory: (
        participantsFactory: ParticipantsFactory,
      ): UnitOfWork<PlanningWorkContext> =>
        useDatabase()
          ? new PgPlanningUnitOfWork(getPool(), participantsFactory)
          : { run: missingDatabase },
      inject: [PARTICIPANTS_FACTORY],
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
    PARTICIPANTS_FACTORY,
    PLANNING_UNIT_OF_WORK,
    PLANNING_READ_PORT,
    CLOCK,
    WRITE_LOG,
  ],
})
export class PlanningCompositionModule {}
