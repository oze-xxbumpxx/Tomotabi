import { asc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { UserId } from "../../../common/domain/user-id";
import { allowedGoogleAccounts } from "../../../infrastructure/database/schema/identity";
import type {
  AllowlistParticipant,
  ParticipantsPort,
} from "../../planning/adapter/outbound/participants.port";

/**
 * planning側のParticipantsPortをidentityの許可リストで実装した公開照会。
 * UnitOfWorkの文脈（同一トランザクションのdb）で生成して使う。
 * 行ロックは取らない（UPDATE権限が無くロックできない。差分1）。
 */
export class PgParticipantsQuery implements ParticipantsPort {
  constructor(private readonly db: NodePgDatabase) {}

  async listEnabled(): Promise<readonly AllowlistParticipant[]> {
    const rows = await this.db
      .select({
        slot: allowedGoogleAccounts.slot,
        userId: allowedGoogleAccounts.userId,
      })
      .from(allowedGoogleAccounts)
      .where(eq(allowedGoogleAccounts.enabled, true))
      .orderBy(asc(allowedGoogleAccounts.slot));
    return rows.map((row) => ({
      slot: row.slot,
      userId: UserId.parse(row.userId),
    }));
  }
}
