import { Pool } from "pg";
import { MIGRATOR_DATABASE_URL } from "./env";

/**
 * 試験ごとの初期化: 業務の表だけを空にする（ADR-0005 Decision 5）。
 * identity.*（利用者・許可リスト・セッション）は残す。migratorで実行し、
 * app_runtimeにはTRUNCATEの権限を与えない。
 */
const TRUNCATE_BUSINESS_TABLES = `TRUNCATE
  planning.plans, planning.trip_participants, planning.trips,
  record.active_plan_events, record.plan_event_cancellations, record.plan_events,
  infra.command_receipts, infra.trip_finance_guards
  RESTART IDENTITY CASCADE`;

let pool: Pool | null = null;

const migratorPool = (): Pool => {
  pool ??= new Pool({ connectionString: MIGRATOR_DATABASE_URL });
  pool.on("error", () => {});
  return pool;
};

export async function resetBusinessTables(): Promise<void> {
  await migratorPool().query(TRUNCATE_BUSINESS_TABLES);
}

/**
 * その旅行の支払いの行数を実DBで数える（FE-04の「支払いは1件だけ」を
 * 再送で二重に作られていないことの裏付けに使う）。
 */
export async function countPayments(tripId: string): Promise<number> {
  const result = await migratorPool().query<{ count: string }>(
    "SELECT count(*)::text AS count FROM record.payments WHERE trip_id = $1",
    [tripId],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error("countPayments returned no row");
  }
  return Number(row.count);
}
