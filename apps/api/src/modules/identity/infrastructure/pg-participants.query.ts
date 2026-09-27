import { asc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { UserId } from "../../../common/domain/user-id";
import { allowedGoogleAccounts } from "../../../infrastructure/database/schema/identity";
import type {
  AllowlistParticipant,
  ParticipantsPort,
} from "../../planning/adapter/outbound/participants.port";

/**
 * planning 側の ParticipantsPort を identity の許可リストで実装した公開照会。
 * UnitOfWork の文脈（同一トランザクションの db）で生成して使う。
 * 行ロックは取らない（UPDATE 権限が無くロックできない。差分 1）。
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
