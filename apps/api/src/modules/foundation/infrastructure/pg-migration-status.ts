import type { Pool } from "pg";
import type { MigrationStatusReader } from "../adapter/outbound/migration-status.port.js";

type Row = { last: string | number | null };

export class PgMigrationStatus implements MigrationStatusReader {
  constructor(private readonly pool: Pool) {}

  async lastAppliedAt(): Promise<number | null> {
    const result = await this.pool.query<Row>(
      'SELECT max(created_at) AS last FROM "drizzle"."__drizzle_migrations"',
    );
    const last = result.rows[0]?.last ?? null;
    if (last === null) {
      return null;
    }
    // pg returns bigint as a string.
    const value = Number(last);
    if (!Number.isSafeInteger(value)) {
      throw new Error(
        "drizzle.__drizzle_migrations.created_at is not a safe integer",
      );
    }
    return value;
  }
}
