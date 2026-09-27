import { describe, expect, it } from "vitest";
import { ApiError } from "../../src/common/http/api-error";
import { parseIdempotencyKey } from "../../src/common/http/idempotency-key";

describe("parseIdempotencyKey", () => {
  it("U-13: UUID を受け付ける", () => {
    const key = "550e8400-e29b-41d4-a716-446655440000";
    expect(parseIdempotencyKey(key)).toBe(key);
  });

  it.each([undefined, "not-a-uuid", "550e8400-e29b-41d4-a716", "{}", " "])(
    "U-13: %s は 400 INVALID_REQUEST",
    (value) => {
      try {
        parseIdempotencyKey(value);
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).status).toBe(400);
        expect((error as ApiError).code).toBe("INVALID_REQUEST");
      }
    },
  );
});
