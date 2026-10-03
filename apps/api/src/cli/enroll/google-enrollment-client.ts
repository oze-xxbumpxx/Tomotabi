/**
 * Googleから返ったIDトークンの、登録に使う項目だけ。
 * nonceはCLI側で照合するため、検証済みかどうかに関わらずそのまま返す。
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
 * 初期登録CLIがGoogleと通信する2操作。テストではfakeに差し替える。
 *
 * - `exchangeCode`: 認可コードを交換し、IDトークンだけを返す（access / refreshは捨てる）。
 * - `verifyIdToken`: 署名・iss・aud・expを検証し、失敗したらthrowする。
 */
export interface GoogleEnrollmentClient {
  exchangeCode(input: ExchangeCodeInput): Promise<string>;
  verifyIdToken(idToken: string): Promise<IdTokenClaims>;
}
