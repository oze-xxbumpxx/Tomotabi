import { Module } from "@nestjs/common";
import type { UnitOfWork } from "../adapter/transaction/unit-of-work";
import { getPool } from "../infrastructure/database/pool";
import {
  FINANCE_UNIT_OF_WORK,
  type FinanceWorkContext,
} from "../modules/record/adapter/outbound/finance-work-context";
import { PgFinanceUnitOfWork } from "../modules/settlement/infrastructure/pg-finance-unit-of-work";
import { PlanningCompositionModule } from "./planning-composition.module";

function useDatabase(): boolean {
  // planning と同じ判定（未設定と空文字はどちらも「DB なし」）。
  return Boolean(process.env.DATABASE_URL);
}

const missingDatabase = (): Promise<never> =>
  Promise.reject(new Error("DATABASE_URL is not set"));

/**
 * record（支払い）の port と財務の UnitOfWork の実装を結ぶ組み立て。
 * 時計・receipt・書き込みログなどの共有の部品は planning の組み立てが
 * そのまま提供する（PlanningCompositionModule の exports を使う）。
 */
@Module({
  imports: [PlanningCompositionModule],
  providers: [
    {
      provide: FINANCE_UNIT_OF_WORK,
      useFactory: (): UnitOfWork<FinanceWorkContext> =>
        useDatabase()
          ? new PgFinanceUnitOfWork(getPool())
          : { run: missingDatabase },
    },
  ],
  // PlanningCompositionModule を再輸出して、record の UseCase が時計・
  // 書き込みログを同じ実装で受け取れるようにする。
  exports: [PlanningCompositionModule, FINANCE_UNIT_OF_WORK],
})
export class RecordCompositionModule {}
