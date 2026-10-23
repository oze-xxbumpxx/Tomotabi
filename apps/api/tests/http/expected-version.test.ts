import { describe, expect, it } from "vitest";
import { ApiError } from "../../src/common/http/api-error";
import { parseExpectedVersion } from "../../src/common/http/expected-version";

describe("parseExpectedVersion", () => {
  it("EV-01: 引用符なしの正整数だけ受け付け、version を返す", () => {
    expect(parseExpectedVersion("3")).toBe("3");
    expect(parseExpectedVersion("123")).toBe("123");
  });

  it("EV-01: 欠落は 428 EXPECTED_VERSION_REQUIRED", () => {
    try {
      parseExpectedVersion(undefined);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(428);
      expect((error as ApiError).code).toBe("EXPECTED_VERSION_REQUIRED");
    }
  });

  it.each(['"3"', "W/3", "3, 4", "0", "03", "-1", "1.5", "abc", "", " 3", "3 ", "*"])(
    "EV-01: %j は 400 INVALID_REQUEST",
    (value) => {
      try {
        parseExpectedVersion(value);
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).status).toBe(400);
        expect((error as ApiError).code).toBe("INVALID_REQUEST");
      }
    },
  );
});
