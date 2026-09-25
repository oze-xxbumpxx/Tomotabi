import { describe, expect, it } from "vitest";
import { UserId } from "../../src/common/domain/user-id";

describe("UserId", () => {
  it("accepts a valid UUID (U-01)", () => {
    const value = "3f6f84c6-3e30-4c1f-9f34-0c7f9d6e2b1a";
    expect(UserId.parse(value)).toBe(value);
  });

  it("rejects a non-UUID string (U-02)", () => {
    expect(() => UserId.parse("abc")).toThrow("UserId must be a UUID");
  });

  it("rejects an empty string (U-02)", () => {
    expect(() => UserId.parse("")).toThrow("UserId must be a UUID");
  });
});
