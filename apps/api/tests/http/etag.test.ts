import { describe, expect, it } from "vitest";
import { ApiError } from "../../src/common/http/api-error";
import { parseIfMatch, toStrongETag } from "../../src/common/http/etag";

describe("parseIfMatch", () => {
  it("U-12: 引用付きの正整数だけ受け付け、version を返す", () => {
    expect(parseIfMatch('"3"')).toBe("3");
    expect(parseIfMatch('"123"')).toBe("123");
  });

  it("U-12: 欠落は 428 IF_MATCH_REQUIRED", () => {
    try {
      parseIfMatch(undefined);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(428);
      expect((error as ApiError).code).toBe("IF_MATCH_REQUIRED");
    }
  });

  it.each(["*", 'W/"3"', '"3", "4"', "3", '"0"', '"03"', '"-1"', '"abc"', '""', " "])(
    "U-12: %s は 400 INVALID_REQUEST",
    (value) => {
      try {
        parseIfMatch(value);
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).status).toBe(400);
        expect((error as ApiError).code).toBe("INVALID_REQUEST");
      }
    },
  );
});

describe("toStrongETag", () => {
  it("version を引用付きの強い ETag にする", () => {
    expect(toStrongETag(3)).toBe('"3"');
    expect(toStrongETag("42")).toBe('"42"');
    expect(toStrongETag(7n)).toBe('"7"');
  });
});
