import type { UserId } from "../../../../common/domain/user-id";

export const PARTICIPANTS_FACTORY = Symbol("PARTICIPANTS_FACTORY");

export type AllowlistParticipant = Readonly<{
  slot: number;
  userId: UserId;
}>;

/**
 * identityの許可リストを読む公開照会。実装はidentity側に置き、
 * compositionがUnitOfWorkの文脈（同一トランザクションのdb）に束ねて渡す。
 */
export type ParticipantsFactory = (db: unknown) => ParticipantsPort;

export interface ParticipantsPort {
  /**
   * 利用可能な許可アカウントをslot昇順で返す（二人揃っていなければ2件未満）。
   * allowlistの行はロックしない: 行ロックには対象表のUPDATE権限が要るが、
   * app_runtimeのallowlistのUPDATEはM1で禁止されている
   * （設計書「正本からの差分」1）。
   */
  listEnabled(): Promise<readonly AllowlistParticipant[]>;
}
