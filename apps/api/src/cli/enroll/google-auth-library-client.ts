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
    const { tokens } = await this.client.getToken({
      code: input.code,
      codeVerifier: input.codeVerifier,
      redirect_uri: input.redirectUri,
    });
    if (!tokens.id_token) {
      throw new EnrollmentError("ID_TOKEN_MISSING", "Google の応答に ID トークンが含まれていません。");
    }
    return tokens.id_token;
  }

  async verifyIdToken(idToken: string): Promise<IdTokenClaims> {
    // 署名・iss（accounts.google.com）・aud・exp はライブラリが検証する。
    const ticket = await this.client.verifyIdToken({
      idToken,
      audience: this.clientId,
    });
    const payload = ticket.getPayload();
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
