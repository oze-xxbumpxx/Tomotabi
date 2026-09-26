/**
 * Google から返った ID トークンの、登録に使う項目だけ。
 * nonce は CLI 側で照合するため、検証済みかどうかに関わらずそのまま返す。
 */
export type IdTokenClaims = {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  nonce: string | null;
};

export type ExchangeCodeInput = {
  code: string;
  codeVerifier: string;
  redirectUri: string;
};

/**
 * 初期登録 CLI が Google と通信する 2 操作。テストでは fake に差し替える。
 *
 * - `exchangeCode`: 認可コードを交換し、ID トークンだけを返す（access / refresh は捨てる）。
 * - `verifyIdToken`: 署名・iss・aud・exp を検証し、失敗したら throw する。
 */
export interface GoogleEnrollmentClient {
  exchangeCode(input: ExchangeCodeInput): Promise<string>;
  verifyIdToken(idToken: string): Promise<IdTokenClaims>;
}
