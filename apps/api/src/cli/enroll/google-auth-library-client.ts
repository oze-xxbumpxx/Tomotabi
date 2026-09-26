import { OAuth2Client } from "google-auth-library";
import type { ExchangeCodeInput, GoogleEnrollmentClient, IdTokenClaims } from "./google-enrollment-client";
import { EnrollmentError } from "./enrollment-error";

export class GoogleAuthLibraryClient implements GoogleEnrollmentClient {
  private readonly client: OAuth2Client;

  constructor(
    private readonly clientId: string,
    clientSecret: string,
  ) {
    this.client = new OAuth2Client({ clientId, clientSecret });
  }

  async exchangeCode(input: ExchangeCodeInput): Promise<string> {
    // ライブラリの例外 message には渡した値が含まれるため、原因は出さず EnrollmentError に包み直す。
    let tokens;
    try {
      ({ tokens } = await this.client.getToken({
        code: input.code,
        codeVerifier: input.codeVerifier,
        redirect_uri: input.redirectUri,
      }));
    } catch {
      throw new EnrollmentError("CODE_EXCHANGE_FAILED", "認可コードの交換に失敗しました。登録を中止しました。");
    }
    if (!tokens.id_token) {
      throw new EnrollmentError("ID_TOKEN_MISSING", "Google の応答に ID トークンが含まれていません。");
    }
    return tokens.id_token;
  }

  async verifyIdToken(idToken: string): Promise<IdTokenClaims> {
    // 署名・iss（accounts.google.com）・aud・exp はライブラリが検証する。
    // 失敗時の例外 message にトークン本体（sub・email・nonce を含む）が入るため、必ず EnrollmentError に包み直す。
    let payload;
    try {
      payload = (
        await this.client.verifyIdToken({
          idToken,
          audience: this.clientId,
        })
      ).getPayload();
    } catch {
      throw new EnrollmentError("ID_TOKEN_INVALID", "ID トークンの検証に失敗しました。登録を中止しました。");
    }
    if (!payload || !payload.sub || !payload.email) {
      throw new EnrollmentError("ID_TOKEN_INVALID", "ID トークンに sub または email がありません。");
    }
    return {
      sub: payload.sub,
      email: payload.email,
      emailVerified: payload.email_verified === true,
      name: payload.name ?? null,
      nonce: payload.nonce ?? null,
    };
  }
}
