import type { Pool } from "pg";
import type { CliIo } from "../shared/console-io";
import type { Slot } from "../shared/slot";
import { buildAuthorizationUrl, createAuthorizationSecrets } from "./authorization-request";
import { EnrollmentError } from "./enrollment-error";
import { insertEnrollment } from "./enrollment-writer";
import type { GoogleEnrollmentClient } from "./google-enrollment-client";
import { startLoopbackServer } from "./loopback-server";

export type EnrollDependencies = {
  clientId: string;
  google: GoogleEnrollmentClient;
  io: CliIo;
  pool: Pool;
  callbackTimeoutMs?: number;
};

export type EnrollResult = { userId: string; slot: Slot };

/** 表示は末尾4文字だけ。sub全体を標準出力に出さない。 */
export function maskSub(sub: string): string {
  return `****${sub.slice(-4)}`;
}

/**
 * 設計書「CLI（ADR-0002）」の1〜5。callbackは1回で閉じ、確認で`yes`以外なら何も登録しない。
 * トークン・code・subの全体はioに渡さない。
 * @throws EnrollmentError中止理由（state / nonce不一致、タイムアウト、確認拒否など）
 * @throws Error Googleの検証失敗やDBの制約違反はそのまま投げる
 */
export async function enrollGoogleAccount(deps: EnrollDependencies, slot: Slot): Promise<EnrollResult> {
  const { io } = deps;

  const secrets = createAuthorizationSecrets();
  const server = await startLoopbackServer({
    expectedState: secrets.state,
    timeoutMs: deps.callbackTimeoutMs,
  });

  let code: string;
  try {
    io.print(`slot ${slot} に登録する Google アカウントで、次の URL をブラウザで開いてください（5 分以内）。`);
    io.print(
      buildAuthorizationUrl({
        clientId: deps.clientId,
        redirectUri: server.redirectUri,
        secrets,
      }),
    );
    code = await server.waitForCode();
  } finally {
    await server.close();
  }

  const idToken = await deps.google.exchangeCode({
    code,
    codeVerifier: secrets.codeVerifier,
    redirectUri: server.redirectUri,
  });
  const claims = await deps.google.verifyIdToken(idToken);
  if (claims.nonce !== secrets.nonce) {
    throw new EnrollmentError("NONCE_MISMATCH", "nonce が一致しません。登録を中止しました。");
  }

  const name = claims.name ?? claims.email;
  io.print(`表示名: ${name}`);
  io.print(`メール: ${claims.email}${claims.emailVerified ? "" : "（未確認）"}`);
  io.print(`sub: ${maskSub(claims.sub)}`);
  const confirmed = await io.confirm(`slot ${slot} に登録しますか？`);
  if (!confirmed) {
    throw new EnrollmentError("CANCELLED", "登録を中止しました。");
  }

  const { userId } = await insertEnrollment(deps.pool, {
    slot,
    sub: claims.sub,
    email: claims.email,
    emailVerified: claims.emailVerified,
    name,
  });
  io.print(`slot ${slot} に登録しました。user_id: ${userId}`);
  return { userId, slot };
}
