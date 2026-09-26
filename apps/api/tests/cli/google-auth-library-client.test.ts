import { OAuth2Client } from "google-auth-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EnrollmentError } from "../../src/cli/enroll/enrollment-error";
import { GoogleAuthLibraryClient } from "../../src/cli/enroll/google-auth-library-client";
import { describeFailure } from "../../src/cli/shared/run-cli";
import { CliUsageError } from "../../src/cli/shared/slot";

const SECRET_LIKE_TOKEN = "SECRET-TOKEN-12345.payload.signature";

describe("GoogleAuthLibraryClient (real library, malformed token)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("raw verifyIdToken echoes the token in the thrown message", async () => {
    // 包み直しが無ければトークンが漏れることを示すため、ライブラリの生の例外で確かめる。
    vi.spyOn(OAuth2Client.prototype, "getFederatedSignonCertsAsync").mockResolvedValue({
      certs: {},
      res: undefined,
    });
    const error = await new OAuth2Client("client-id").verifyIdToken({
      idToken: "one.two",
      audience: "client-id",
    }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("one.two");
  });

  it("wraps verifyIdToken failures in EnrollmentError and never echoes the token", async () => {
    // 証明書の取得を差し替えて外部通信なしで失敗経路を通す。
    vi.spyOn(OAuth2Client.prototype, "getFederatedSignonCertsAsync").mockResolvedValue({
      certs: {},
      res: undefined,
    });
    const client = new GoogleAuthLibraryClient("client-id", "client-secret");
    const error = await client.verifyIdToken(SECRET_LIKE_TOKEN).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(EnrollmentError);
    const enrollmentError = error as EnrollmentError;
    expect(enrollmentError.code).toBe("ID_TOKEN_INVALID");
    expect(enrollmentError.message).not.toContain(SECRET_LIKE_TOKEN);
    expect(describeFailure(enrollmentError)).not.toContain(SECRET_LIKE_TOKEN);
  });

  it("describeFailure prints only error.name for unexpected errors", () => {
    const message = describeFailure(new Error(`failure: ${SECRET_LIKE_TOKEN}`));
    expect(message).not.toContain(SECRET_LIKE_TOKEN);
    expect(message).toBe("予期しないエラーが発生しました (Error)");
  });

  it("describeFailure still prints messages of known error classes", () => {
    expect(describeFailure(new EnrollmentError("CANCELLED", "登録を中止しました。"))).toBe("登録を中止しました。");
    expect(describeFailure(new CliUsageError("usage: --slot 0|1"))).toBe("usage: --slot 0|1");
  });
});
