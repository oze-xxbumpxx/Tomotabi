import type { Pool } from "pg";
import type { UserId } from "../../../common/domain/user-id";
import type { IdentityReader } from "../adapter/outbound/identity-reader";

export class PgIdentityReader implements IdentityReader {
  constructor(private readonly pool: Pool) {}

  async findDisplayName(userId: UserId): Promise<string | null> {
    const result = await this.pool.query<{ name: string }>(
      "SELECT name FROM identity.users WHERE id = $1",
      [userId],
    );
    return result.rows[0]?.name ?? null;
  }
}
