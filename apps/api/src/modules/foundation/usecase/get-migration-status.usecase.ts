import type { MigrationStatusView } from "@tomotabi/contracts";
import type { Clock } from "../../../adapter/clock/clock.js";
import type { GetMigrationStatusInputPort } from "../adapter/inbound/get-migration-status.input-port.js";
import type { MigrationStatusReader } from "../adapter/outbound/migration-status.port.js";

// The route is public, so repeated calls must not each take a DB connection.
// The deploy check runs long after a manual migrate, so a few seconds of staleness is harmless.
export const MIGRATION_STATUS_CACHE_MS = 10_000;

export class GetMigrationStatusUseCase implements GetMigrationStatusInputPort {
  private cached: { view: MigrationStatusView; readAt: number } | null = null;
  private inFlight: Promise<MigrationStatusView> | null = null;

  constructor(
    private readonly migrations: MigrationStatusReader,
    private readonly clock: Clock,
  ) {}

  /**
   * 同じプロセスでは、DBを読むのは`MIGRATION_STATUS_CACHE_MS`に1回まで。
   * 読んでいる間に来た要求は、その1回の結果を待つ。失敗は覚えない。
   */
  async execute(): Promise<MigrationStatusView> {
    const now = this.clock.now().getTime();
    if (
      this.cached !== null &&
      now - this.cached.readAt < MIGRATION_STATUS_CACHE_MS
    ) {
      return this.cached.view;
    }
    if (this.inFlight === null) {
      this.inFlight = this.read().finally(() => {
        this.inFlight = null;
      });
    }
    return this.inFlight;
  }

  private async read(): Promise<MigrationStatusView> {
    const view: MigrationStatusView = {
      lastAppliedAt: await this.migrations.lastAppliedAt(),
    };
    this.cached = { view, readAt: this.clock.now().getTime() };
    return view;
  }
}
