import { Module } from "@nestjs/common";
import { getPool } from "../infrastructure/database/pool";
import {
  SETTLEMENT_READ_UNIT_OF_WORK,
  SETTLEMENT_UNIT_OF_WORK,
  type SettlementReadUnitOfWork,
  type SettlementUnitOfWork,
} from "../modules/settlement/adapter/outbound/settlement-work-context";
import { PgFinanceUnitOfWork } from "../modules/settlement/infrastructure/pg-finance-unit-of-work";
import { PgSettlementReadUnitOfWork } from "../modules/settlement/infrastructure/pg-settlement-read.unit-of-work";
import { RecordCompositionModule } from "./record-composition.module";

function useDatabase(): boolean {
  // planning / recordと同じ判定（未設定と空文字はどちらも「DBなし」）。
  return Boolean(process.env.DATABASE_URL);
}

const missingDatabase = (): Promise<never> =>
  Promise.reject(new Error("DATABASE_URL is not set"));

/**
 * settlement（残額・確認・精算）のUnitOfWorkの実装を結ぶ組み立て。
 * 書き込みは財務共通のPgFinanceUnitOfWork（文脈がsettlementの
 * ポートを足した形）、読み取りはREPEATABLE READの別の束ね。
 */
@Module({
  imports: [RecordCompositionModule],
  providers: [
    {
      provide: SETTLEMENT_UNIT_OF_WORK,
      useFactory: (): SettlementUnitOfWork =>
        useDatabase()
          ? new PgFinanceUnitOfWork(getPool())
          : { run: missingDatabase },
    },
    {
      provide: SETTLEMENT_READ_UNIT_OF_WORK,
      useFactory: (): SettlementReadUnitOfWork =>
        useDatabase()
          ? new PgSettlementReadUnitOfWork(getPool())
          : { run: missingDatabase },
    },
  ],
  // RecordCompositionModuleを再輸出して、settlementのUseCaseが
  // 時計・書き込みログをrecordと同じ実装で受け取れるようにする。
  exports: [
    RecordCompositionModule,
    SETTLEMENT_UNIT_OF_WORK,
    SETTLEMENT_READ_UNIT_OF_WORK,
  ],
})
export class SettlementCompositionModule {}
