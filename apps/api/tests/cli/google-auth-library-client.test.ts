import { describe, expect, it } from "vitest";
import { EnrollmentError } from "../../src/cli/enroll/enrollment-error";
import { GoogleAuthLibraryClient } from "../../src/cli/enroll/google-auth-library-client";
import { describeFailure } from "../../src/cli/shared/run-cli";
import { CliUsageError } from "../../src/cli/shared/slot";

const SECRET_LIKE_TOKEN = "SECRET-TOKEN-12345.payload.signature";

describe("GoogleAuthLibraryClient (real library, malformed token)", () => {
  const client = new GoogleAuthLibraryClient("client-id", "client-secret");

  it("wraps verifyIdToken failures in EnrollmentError and never echoes the token", async () => {
    const error = await client.verifyIdToken(SECRET_LIKE_TOKEN).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(EnrollmentError);
    expect((error as EnrollmentError).code).toBe("ID_TOKEN_INVALID");
    expect(JSON.stringify(error)).not.toContain(SECRET_LIKE_TOKEN);
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
