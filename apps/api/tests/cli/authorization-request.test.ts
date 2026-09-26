import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildAuthorizationUrl,
  createAuthorizationSecrets,
  GOOGLE_AUTHORIZATION_ENDPOINT,
} from "../../src/cli/enroll/authorization-request";

describe("authorization request", () => {
  it("generates distinct random secrets on each call", () => {
    const a = createAuthorizationSecrets();
    const b = createAuthorizationSecrets();
    expect(a.state).not.toBe(b.state);
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.codeVerifier).not.toBe(b.codeVerifier);
    expect(new Set([a.state, a.nonce, a.codeVerifier]).size).toBe(3);
    expect(a.codeVerifier.length).toBeGreaterThanOrEqual(43);
  });

  it("builds the Google URL with state, nonce and an S256 PKCE challenge", () => {
    const secrets = {
      state: "st",
      nonce: "nc",
      codeVerifier: "verifier-value",
    };
    const url = new URL(
      buildAuthorizationUrl({
        clientId: "client-id",
        redirectUri: "http://127.0.0.1:1234/callback",
        secrets,
      }),
    );
    expect(`${url.origin}${url.pathname}`).toBe(GOOGLE_AUTHORIZATION_ENDPOINT);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "client-id",
      redirect_uri: "http://127.0.0.1:1234/callback",
      response_type: "code",
      scope: "openid email profile",
      state: "st",
      nonce: "nc",
      code_challenge: createHash("sha256").update("verifier-value").digest("base64url"),
      code_challenge_method: "S256",
      prompt: "select_account",
    });
    expect(url.toString()).not.toContain("verifier-value");
  });
});
