import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import type { UnitOfWork } from "../../../adapter/transaction/unit-of-work";
import type { SettlementReadContext } from "../adapter/outbound/settlement-work-context";
import { DrizzleSettlementRepository } from "./drizzle-settlement.repository";
import { PgPaymentsRead } from "./pg-payments-read";
import { PgTripRosterQuery } from "./pg-finance-unit-of-work";

/**
 * 残額・確認の読み取りをREPEATABLE READの短い読み取りトランザクションに
 * 束ねる（設計書「読み取り」）。支払い・取り消し・占有・精算を1つの
 * スナップショットから読む。READ ONLYで書き込みをないことにする。
 */
export class PgSettlementReadUnitOfWork
  implements UnitOfWork<SettlementReadContext>
{
  constructor(private readonly pool: Pool) {}

  async run<T>(
    work: (ctx: SettlementReadContext) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    let released = false;
    try {
      await client.query(
        "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
      );
      const db = drizzle(client);
      const result = await work({
        roster: new PgTripRosterQuery(db),
        paymentsRead: new PgPaymentsRead(db),
        settlements: new DrizzleSettlementRepository(db),
      });
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        // ROLLBACK自体が失敗した接続（切断など）は壊れているため、
        // プールに戻さず捨てる。
        client.release(
          rollbackError instanceof Error
            ? rollbackError
            : new Error("ROLLBACK に失敗しました", { cause: rollbackError }),
        );
        released = true;
        throw error;
      }
      throw error;
    } finally {
      if (!released) {
        client.release();
      }
    }
  }
}
