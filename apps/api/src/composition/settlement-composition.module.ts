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
  // planning / record と同じ判定（未設定と空文字はどちらも「DB なし」）。
  return Boolean(process.env.DATABASE_URL);
}

const missingDatabase = (): Promise<never> =>
  Promise.reject(new Error("DATABASE_URL is not set"));

/**
 * settlement（残額・確認・精算）の UnitOfWork の実装を結ぶ組み立て。
 * 書き込みは財務共通の PgFinanceUnitOfWork（文脈が settlement の
 * ポートを足した形）、読み取りは REPEATABLE READ の別の束ね。
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
  // RecordCompositionModule を再輸出して、settlement の UseCase が
  // 時計・書き込みログを record と同じ実装で受け取れるようにする。
  exports: [
    RecordCompositionModule,
    SETTLEMENT_UNIT_OF_WORK,
    SETTLEMENT_READ_UNIT_OF_WORK,
  ],
})
export class SettlementCompositionModule {}
