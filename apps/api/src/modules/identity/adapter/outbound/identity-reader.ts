import type { UserId } from "../../../../common/domain/user-id";

export const IDENTITY_READER = Symbol("IDENTITY_READER");

export interface IdentityReader {
  /**
   * 利用者が見つからないときは null を返す。
   */
  findDisplayName(userId: UserId): Promise<string | null>;
}
