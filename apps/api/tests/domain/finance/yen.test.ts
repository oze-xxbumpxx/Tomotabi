import { describe, expect, it } from "vitest";
import { PaymentYen, SignedYen } from "../../../src/common/domain/yen";

describe("PaymentYen", () => {
  it.each([
    ["1", true],
    ["7001", true],
    ["9999999", true],
    ["0", false],
    ["10000000", false],
    ["-1", false],
    ["1.5", false],
    ["abc", false],
    ["01", false],
    ["", false],
    ["+100", false],
    [" 100", false],
  ])("FU-01: %s を支払い額として%s", (value, valid) => {
    if (valid) {
      expect(PaymentYen.parse(value)).toBe(BigInt(value));
    } else {
      expect(() => PaymentYen.parse(value)).toThrow();
    }
  });

  it("FU-01: 中身は bigint（Number を通さない）", () => {
    expect(typeof PaymentYen.parse("7001")).toBe("bigint");
  });

  it("FU-01: 10 進文字列との往復", () => {
    const value = PaymentYen.parse("7001");
    expect(PaymentYen.toDecimalString(value)).toBe("7001");
    expect(PaymentYen.parse(PaymentYen.toDecimalString(value))).toBe(value);
  });
});

describe("SignedYen", () => {
  it.each([
    ["0", true],
    ["7001", true],
    ["-1", true],
    ["-3500", true],
    ["-0", false],
    ["1.5", false],
    ["abc", false],
    ["01", false],
    ["+5", false],
  ])("FU-01: %s を符号付きの円として%s", (value, valid) => {
    if (valid) {
      expect(SignedYen.parse(value)).toBe(BigInt(value));
    } else {
      expect(() => SignedYen.parse(value)).toThrow();
    }
  });

  it("FU-01: 負の値は支払い額にはできず、符号付きの型では作れる（別の型）", () => {
    expect(() => PaymentYen.parse("-1")).toThrow();
    expect(SignedYen.parse("-1")).toBe(-1n);
  });

  it("FU-01: 中身は bigint", () => {
    expect(typeof SignedYen.parse("-3500")).toBe("bigint");
    expect(SignedYen.toDecimalString(SignedYen.parse("-3500"))).toBe("-3500");
  });

  it("FU-01: add と negate は符号付きのまま計算する", () => {
    const a = SignedYen.parse("3000");
    const b = SignedYen.parse("-5000");
    expect(SignedYen.add(a, b)).toBe(-2000n);
    expect(SignedYen.negate(a)).toBe(-3000n);
    expect(SignedYen.negate(SignedYen.negate(a))).toBe(3000n);
  });
});
