import type { MigrationStatusReader } from "../adapter/outbound/migration-status.port.js";

export class InMemoryMigrationStatus implements MigrationStatusReader {
  async lastAppliedAt(): Promise<number | null> {
    return null;
  }
}
