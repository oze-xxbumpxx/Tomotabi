import type { CliIo } from "../../src/cli/shared/console-io";
import type {
  ExchangeCodeInput,
  GoogleEnrollmentClient,
  IdTokenClaims,
} from "../../src/cli/enroll/google-enrollment-client";

export const FAKE_CLIENT_ID = "fake-client-id.apps.googleusercontent.com";
export const FAKE_CODE = "fake-authorization-code-XYZ";
export const FAKE_ID_TOKEN_PREFIX = "fake-id-token.";

export type FakePayload = {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
  aud: string;
  iss: string;
  exp: number;
  nonce: string | null;
};

export type PayloadOverride = Partial<FakePayload>;

/**
 * Google 通信の fake。ブラウザ（openBrowser）が認可 URL から state / nonce を取り出して callback を叩き、
 * exchangeCode は JSON を埋め込んだ「ID トークン」を返し、verifyIdToken が aud / iss / exp を検査する
 * （google-auth-library の verifyIdToken と同じ失敗条件を模す）。nonce の照合は CLI 側の責務。
 */
export class FakeGoogle implements GoogleEnrollmentClient {
  readonly exchanges: ExchangeCodeInput[] = [];
  nonceFromBrowser: string | null = null;

  constructor(
    private readonly account: {
      sub: string;
      email: string;
      name?: string;
      emailVerified?: boolean;
    },
    private readonly override: PayloadOverride = {},
  ) {}

  /** 認可 URL を開いた「ブラウザ」。state はそのまま（tamperState で改ざん）、code を付けて callback へ。 */
  async openBrowser(authorizationUrl: string, tamperState?: (state: string) => string): Promise<void> {
    const url = new URL(authorizationUrl);
    const redirectUri = url.searchParams.get("redirect_uri")!;
    const state = url.searchParams.get("state")!;
    this.nonceFromBrowser = url.searchParams.get("nonce");
    const params = new URLSearchParams({
      state: tamperState ? tamperState(state) : state,
      code: FAKE_CODE,
    });
    await fetch(`${redirectUri}?${params.toString()}`);
  }

  async exchangeCode(input: ExchangeCodeInput): Promise<string> {
    this.exchanges.push(input);
    if (input.code !== FAKE_CODE) {
      throw new Error("invalid_grant");
    }
    const payload: FakePayload = {
      sub: this.account.sub,
      email: this.account.email,
      email_verified: this.account.emailVerified ?? true,
      name: this.account.name,
      aud: FAKE_CLIENT_ID,
      iss: "https://accounts.google.com",
      exp: Math.floor(Date.now() / 1000) + 3600,
      nonce: this.nonceFromBrowser,
      ...this.override,
    };
    return `${FAKE_ID_TOKEN_PREFIX}${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
  }

  async verifyIdToken(idToken: string): Promise<IdTokenClaims> {
    if (!idToken.startsWith(FAKE_ID_TOKEN_PREFIX)) {
      throw new Error("Invalid token signature");
    }
    const payload = JSON.parse(
      Buffer.from(idToken.slice(FAKE_ID_TOKEN_PREFIX.length), "base64url").toString("utf8"),
    ) as FakePayload;
    if (payload.aud !== FAKE_CLIENT_ID) {
      throw new Error("Wrong recipient, payload audience != requiredAudience");
    }
    if (payload.iss !== "https://accounts.google.com" && payload.iss !== "accounts.google.com") {
      throw new Error("Invalid issuer");
    }
    if (payload.exp <= Math.floor(Date.now() / 1000)) {
      throw new Error("Token used too late");
    }
    return {
      sub: payload.sub,
      email: payload.email,
      emailVerified: payload.email_verified,
      name: payload.name ?? null,
      nonce: payload.nonce,
    };
  }
}

/** 標準出力を溜め、confirm には決めた答えを返す io。 */
export class RecordingIo implements CliIo {
  readonly lines: string[] = [];
  readonly prompts: string[] = [];
  onAuthorizationUrl: ((url: string) => Promise<void>) | null = null;

  constructor(private readonly answer: string) {}

  print(line: string): void {
    this.lines.push(line);
    if (line.startsWith("https://accounts.google.com/") && this.onAuthorizationUrl) {
      // 実際の利用者がブラウザで URL を開く動作を非同期に模す
      void this.onAuthorizationUrl(line);
    }
  }

  async confirm(prompt: string): Promise<boolean> {
    this.prompts.push(prompt);
    return this.answer.trim() === "yes";
  }

  get output(): string {
    return [...this.lines, ...this.prompts].join("\n");
  }
}
