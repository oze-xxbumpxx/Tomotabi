import type { MigrationStatusView } from "@tomotabi/contracts";
import type { GetMigrationStatusInputPort } from "../adapter/inbound/get-migration-status.input-port.js";
import type { MigrationStatusReader } from "../adapter/outbound/migration-status.port.js";

export class GetMigrationStatusUseCase implements GetMigrationStatusInputPort {
  constructor(private readonly migrations: MigrationStatusReader) {}

  async execute(): Promise<MigrationStatusView> {
    return { lastAppliedAt: await this.migrations.lastAppliedAt() };
  }
}
