import type { UserId } from "../../../../common/domain/user-id";

export const PARTICIPANTS_FACTORY = Symbol("PARTICIPANTS_FACTORY");

export type AllowlistParticipant = Readonly<{
  slot: number;
  userId: UserId;
}>;

/**
 * identity の許可リストを読む公開照会。実装は identity 側に置き、
 * composition が UnitOfWork の文脈（同一トランザクションの db）に束ねて渡す。
 */
export type ParticipantsFactory = (db: unknown) => ParticipantsPort;

export interface ParticipantsPort {
  /**
   * 利用可能な許可アカウントを slot 昇順で返す（二人揃っていなければ 2 件未満）。
   * allowlist の行はロックしない: 行ロックには対象表の UPDATE 権限が要るが、
   * app_runtime の allowlist の UPDATE は M1 で禁止されている
   * （設計書「正本からの差分」1）。
   */
  listEnabled(): Promise<readonly AllowlistParticipant[]>;
}
