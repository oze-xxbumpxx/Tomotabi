import { createHash, randomBytes } from "node:crypto";

export const GOOGLE_AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";

export type AuthorizationSecrets = {
  state: string;
  nonce: string;
  codeVerifier: string;
};

const random = (): string => randomBytes(32).toString("base64url");

/** state / nonce / PKCE verifier を毎回ランダムに生成する（使い捨て）。 */
export function createAuthorizationSecrets(): AuthorizationSecrets {
  return { state: random(), nonce: random(), codeVerifier: random() };
}

export function buildAuthorizationUrl(input: {
  clientId: string;
  redirectUri: string;
  secrets: AuthorizationSecrets;
}): string {
  const codeChallenge = createHash("sha256").update(input.secrets.codeVerifier).digest("base64url");
  const url = new URL(GOOGLE_AUTHORIZATION_ENDPOINT);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", input.secrets.state);
  url.searchParams.set("nonce", input.secrets.nonce);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}
