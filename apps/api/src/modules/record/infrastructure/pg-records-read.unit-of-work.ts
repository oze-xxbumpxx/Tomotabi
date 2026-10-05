import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import type { UnitOfWork } from "../../../adapter/transaction/unit-of-work";
import type { RecordsReadContext } from "../adapter/outbound/records-read.port";
import { PgTripRosterQuery } from "../../settlement/infrastructure/pg-finance-unit-of-work";
import { PgRecordsRead } from "./pg-records-read";

/**
 * 記録の一覧の読み取りをREPEATABLE READの短い読み取りトランザクションに
 * 束ねる（詳細設計「読み取り」）。一覧と中身を1つのスナップショットから
 * 読む。READ ONLYで書き込みをないことにする。
 */
export class PgRecordsReadUnitOfWork implements UnitOfWork<RecordsReadContext> {
  constructor(private readonly pool: Pool) {}

  async run<T>(work: (ctx: RecordsReadContext) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let released = false;
    try {
      await client.query(
        "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
      );
      const db = drizzle(client);
      const result = await work({
        roster: new PgTripRosterQuery(db),
        records: new PgRecordsRead(db),
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
