import { Controller, Get, Inject } from "@nestjs/common";
import type { HealthView, MigrationStatusView } from "@tomotabi/contracts";
import { PublicRoute } from "../../../common/guard/public-route.decorator.js";
import {
  GET_MIGRATION_STATUS_INPUT_PORT,
  type GetMigrationStatusInputPort,
} from "../adapter/inbound/get-migration-status.input-port.js";

@Controller("health")
export class HealthController {
  constructor(
    @Inject(GET_MIGRATION_STATUS_INPUT_PORT)
    private readonly getMigrationStatus: GetMigrationStatusInputPort,
  ) {}

  // Does not touch the database: E2E and manual-push wait on this route while the DB may still be starting.
  @Get()
  @PublicRoute()
  get(): HealthView {
    return { status: "ok" };
  }

  // Read by the deploy workflow before shipping (docs/designs/migration-deploy-check.md).
  @Get("migrations")
  @PublicRoute()
  migrations(): Promise<MigrationStatusView> {
    return this.getMigrationStatus.execute();
  }
}
