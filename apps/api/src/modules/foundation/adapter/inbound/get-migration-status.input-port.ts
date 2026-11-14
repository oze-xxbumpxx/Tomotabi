import type { MigrationStatusView } from "@tomotabi/contracts";

export const GET_MIGRATION_STATUS_INPUT_PORT = Symbol(
  "GET_MIGRATION_STATUS_INPUT_PORT",
);

export interface GetMigrationStatusInputPort {
  execute(): Promise<MigrationStatusView>;
}
