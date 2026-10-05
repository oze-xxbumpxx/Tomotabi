import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool, PoolClient } from "pg";
import { ApiError } from "../../../common/http/api-error";
import type {
  HomeReadContext,
  HomeReadUnitOfWork,
  HomeSectionResult,
} from "../adapter/outbound/home-read.port";
import { isUnrecoverableHomeReadError } from "../adapter/outbound/home-read.port";
import type { HomeBalanceFactory } from "../adapter/outbound/home-balance.port";
import type { HomeRecordsFactory } from "../adapter/outbound/home-records.port";
import { PgHomeRead } from "./pg-home-read";

/** 回復できない欄の失敗を、ホーム全体の503に写す。 */
function homeUnavailable(): ApiError {
  return new ApiError({
    code: "TEMPORARILY_UNAVAILABLE",
    status: 503,
    message: "Service is temporarily unavailable",
  });
}

/**
 * 欄の読み取りをセーブポイントで囲む実装。欄のクエリが回復できる誤り
 * で失敗したらROLLBACK TO SAVEPOINTして`failed`を返す。接続が切れた・
 * 認証の失敗など回復できない誤り、および巻き戻し自体の失敗は、
 * ホーム全体の503にする。
 */
class PgSectionRunner {
  private sequence = 0;

  constructor(private readonly client: PoolClient) {}

  async run<T>(work: () => Promise<T>): Promise<HomeSectionResult<T>> {
    const name = `home_section_${++this.sequence}`;
    try {
      await this.client.query(`SAVEPOINT ${name}`);
      const data = await work();
      await this.client.query(`RELEASE SAVEPOINT ${name}`);
      return { status: "ok", data };
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      if (isUnrecoverableHomeReadError(error)) {
        throw homeUnavailable();
      }
      try {
        await this.client.query(`ROLLBACK TO SAVEPOINT ${name}`);
      } catch {
        // 巻き戻せない接続（切断など）はトランザクションごと使えない。
        throw homeUnavailable();
      }
      return { status: "failed", error };
    }
  }
}

/**
 * ホームの読み取りを1つのREPEATABLE READ・READ ONLYトランザクションに
 * 束ねる（詳細設計「ホーム」）。旅行 → 予定の欄 → 精算の欄 →
 * 最近の記録を同じスナップショットから順に読む。欄は`runSection`の
 * セーブポイントで囲み、同じ接続にクエリを並べて投げない。
 */
export class PgHomeReadUnitOfWork implements HomeReadUnitOfWork {
  constructor(
    private readonly pool: Pool,
    private readonly recordsFactory: HomeRecordsFactory,
    private readonly balanceFactory: HomeBalanceFactory,
  ) {}

  async run<T>(work: (ctx: HomeReadContext) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let released = false;
    try {
      await client.query(
        "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
      );
      const db = drizzle(client);
      const homeRead = new PgHomeRead(db);
      const runner = new PgSectionRunner(client);
      const result = await work({
        trip: homeRead,
        schedule: homeRead,
        balance: this.balanceFactory(db),
        records: this.recordsFactory(db),
        runSection: (sectionWork) => runner.run(sectionWork),
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
