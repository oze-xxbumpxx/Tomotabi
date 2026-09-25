export const IDENTITY_READER = Symbol("IDENTITY_READER");

export interface IdentityReader {
  /**
   * 利用者が見つからないときは null を返す。
   */
  findDisplayName(userId: string): Promise<string | null>;
}
