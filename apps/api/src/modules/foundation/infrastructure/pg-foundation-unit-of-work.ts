import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import type { UnitOfWork } from "../../../adapter/transaction/unit-of-work";
import type { ProbeWorkContext } from "../adapter/outbound/probe-work-context";
import { PgProbeRepository } from "./pg-probe.repository";

export class PgFoundationUnitOfWork implements UnitOfWork<ProbeWorkContext> {
  constructor(private readonly pool: Pool) {}

  async run<T>(work: (ctx: ProbeWorkContext) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const db = drizzle(client);
      const result = await work({
        probes: new PgProbeRepository(db),
      });
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
