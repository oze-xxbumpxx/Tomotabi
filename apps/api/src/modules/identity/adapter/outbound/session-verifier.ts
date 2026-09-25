import type { UserId } from "../../../../common/domain/user-id";

export const SESSION_VERIFIER = Symbol("SESSION_VERIFIER");

/**
 * Cookie を含む要求ヘッダー。Node の IncomingHttpHeaders と同じ形。
 */
export type SessionVerifierHeaders = Readonly<
  Record<string, string | string[] | undefined>
>;

export type SessionVerificationResult =
  | { kind: "authenticated"; userId: UserId; expiresAt: Date }
  | { kind: "unauthenticated" }
  | { kind: "forbidden" }
  | { kind: "unavailable" };

/**
 * 認証失敗・許可なし・認証基盤の障害は例外ではなく 4 値の結果で返す。
 */
export interface SessionVerifier {
  verify(
    headers: SessionVerifierHeaders,
  ): Promise<SessionVerificationResult>;
}
