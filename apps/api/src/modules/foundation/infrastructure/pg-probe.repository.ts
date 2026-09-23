import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { ProbeRepository } from "../adapter/outbound/probe.repository";
import { ProbeCount } from "../domain/probe-count";
import { m0Probes } from "./m0-probe.schema";

export const M0_PROBE_ID = "default";

export class PgProbeRepository implements ProbeRepository {
  constructor(private readonly db: NodePgDatabase) {}

  async getCount(): Promise<ProbeCount> {
    const rows = await this.db
      .select()
      .from(m0Probes)
      .where(eq(m0Probes.id, M0_PROBE_ID));
    const row = rows[0];
    return ProbeCount.create(row?.count ?? 0);
  }

  async save(count: ProbeCount): Promise<void> {
    await this.db
      .insert(m0Probes)
      .values({ id: M0_PROBE_ID, count: count.value })
      .onConflictDoUpdate({
        target: m0Probes.id,
        set: { count: count.value },
      });
  }
}
