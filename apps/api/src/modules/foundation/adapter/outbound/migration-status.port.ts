export const MIGRATION_STATUS_READER = Symbol("MIGRATION_STATUS_READER");

export interface MigrationStatusReader {
  /**
   * Newest applied migration in milliseconds, the same number as `when` in
   * `apps/api/drizzle/meta/_journal.json`. `null` when no migration has been applied.
   * @throws when the history table cannot be read or holds a value that is not a safe integer.
   */
  lastAppliedAt(): Promise<number | null>;
}
