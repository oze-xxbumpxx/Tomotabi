import { fromNodeHeaders } from "better-auth/node";
import type { Pool } from "pg";
import type { IncomingHttpHeaders } from "node:http";
import { UserId } from "../../../common/domain/user-id";
import type {
  SessionVerificationResult,
  SessionVerifier,
  SessionVerifierHeaders,
} from "../adapter/outbound/session-verifier";
import { isAllowedGoogleAccount } from "./allowlist-query";

/**
 * `auth.api.getSession` だけに依存する最小の見え方。
 * テストは auth を立てずにこの形だけ差し替えられる。
 */
export interface SessionLookup {
  getSession(input: {
    headers: Headers;
  }): Promise<{ session: { userId: string; expiresAt: Date } } | null>;
}

/**
 * Better Auth のセッション Cookie を検証し、毎要求ごとに許可リストを再確認する。
 * DB 未到達・ライブラリ内部の例外は投げず `unavailable` に畳み込む（ログは
 * res.locals.code の AUTH_UNAVAILABLE で追える）。
 */
export class BetterAuthSessionVerifier implements SessionVerifier {
  constructor(
    private readonly sessionLookup: SessionLookup | null,
    private readonly pool: Pool | null,
  ) {}

  async verify(
    headers: SessionVerifierHeaders,
  ): Promise<SessionVerificationResult> {
    if (this.sessionLookup === null || this.pool === null) {
      return { kind: "unavailable" };
    }
    try {
      const result = await this.sessionLookup.getSession({
        headers: fromNodeHeaders(headers as IncomingHttpHeaders),
      });
      if (result === null) {
        return { kind: "unauthenticated" };
      }
      const allowed = await isAllowedGoogleAccount(
        this.pool,
        result.session.userId,
      );
      if (!allowed) {
        return { kind: "forbidden" };
      }
      return {
        kind: "authenticated",
        userId: UserId.parse(result.session.userId),
        expiresAt: result.session.expiresAt,
      };
    } catch {
      return { kind: "unavailable" };
    }
  }
}
