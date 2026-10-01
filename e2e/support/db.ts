import { Pool } from "pg";
import { MIGRATOR_DATABASE_URL } from "./env";

/**
 * 試験ごとの初期化: 業務の表だけを空にする（ADR-0005 Decision 5）。
 * identity.*（利用者・許可リスト・セッション）は残す。migrator で実行し、
 * app_runtime には TRUNCATE の権限を与えない。
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
