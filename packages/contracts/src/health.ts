export type HealthView = {
  status: "ok";
};

/**
 * `lastAppliedAt` is the newest applied migration in milliseconds, the same number as `when`
 * in `apps/api/drizzle/meta/_journal.json`. `null` when no migration has been applied.
 */
export type MigrationStatusView = {
  lastAppliedAt: number | null;
};
