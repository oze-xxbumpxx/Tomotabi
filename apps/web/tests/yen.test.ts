import { describe, expect, it } from "vitest";
import {
  formatYen,
  groupYenInput,
  isPaymentYenAmount,
  PAYMENT_YEN_MAX,
  yenFromDecimalString,
  yenFromInput,
  yenToDecimalString,
} from "@/shared/lib/yen";

describe("yenFromDecimalString / yenToDecimalString", () => {
  it("10 進の整数文字列と BigInt を往復する", () => {
    expect(yenFromDecimalString("7001")).toBe(7001n);
    expect(yenFromDecimalString("0")).toBe(0n);
    expect(yenFromDecimalString("-3500")).toBe(-3500n);
    expect(yenToDecimalString(7001n)).toBe("7001");
    expect(yenToDecimalString(-3500n)).toBe("-3500");
    expect(yenToDecimalString(0n)).toBe("0");
  });

  it("形式が違う文字列は null（カンマ・小数・空白・符号・数字以外）", () => {
    expect(yenFromDecimalString("7,001")).toBeNull();
    expect(yenFromDecimalString("1.5")).toBeNull();
    expect(yenFromDecimalString(" 7001")).toBeNull();
    expect(yenFromDecimalString("+1")).toBeNull();
    expect(yenFromDecimalString("abc")).toBeNull();
    expect(yenFromDecimalString("")).toBeNull();
  });

  it("Number の精度を超える値もそのまま扱える", () => {
    const big = "9007199254740993";
    expect(yenToDecimalString(yenFromDecimalString(big) as bigint)).toBe(big);
  });
});

describe("yenFromInput（入力の正規化）", () => {
  it("全角数字とカンマ（半角・全角）を受ける", () => {
    expect(yenFromInput("7001")).toBe(7001n);
    expect(yenFromInput("７００１")).toBe(7001n);
    expect(yenFromInput("7,001")).toBe(7001n);
    expect(yenFromInput("7，001")).toBe(7001n);
    expect(yenFromInput("1,000,000")).toBe(1000000n);
  });

  it("前後の空白（全角スペースを含む）を除く", () => {
    expect(yenFromInput(" 7001 ")).toBe(7001n);
    expect(yenFromInput("　7001　")).toBe(7001n);
  });

  it("空・小数・符号・数字以外が混ざる入力は null", () => {
    expect(yenFromInput("")).toBeNull();
    expect(yenFromInput(" ")).toBeNull();
    expect(yenFromInput("1.5")).toBeNull();
    expect(yenFromInput("-100")).toBeNull();
    expect(yenFromInput("abc")).toBeNull();
    expect(yenFromInput("12a3")).toBeNull();
    expect(yenFromInput("円7001")).toBeNull();
  });
});

describe("formatYen（3 桁区切りの表示）", () => {
  it("桁区切りと「円」を付ける", () => {
    expect(formatYen(7001n)).toBe("7,001 円");
    expect(formatYen(500n)).toBe("500 円");
    expect(formatYen(0n)).toBe("0 円");
    expect(formatYen(50000n)).toBe("50,000 円");
    expect(formatYen(1000000n)).toBe("1,000,000 円");
    expect(formatYen(9999999n)).toBe("9,999,999 円");
  });

  it("負の値は先頭に - を付ける", () => {
    expect(formatYen(-3500n)).toBe("-3,500 円");
    expect(formatYen(-1n)).toBe("-1 円");
  });
});

describe("isPaymentYenAmount（支払い 1 件の範囲）", () => {
  it("1〜9,999,999 円だけを受ける", () => {
    expect(isPaymentYenAmount(0n)).toBe(false);
    expect(isPaymentYenAmount(-1n)).toBe(false);
    expect(isPaymentYenAmount(1n)).toBe(true);
    expect(isPaymentYenAmount(PAYMENT_YEN_MAX)).toBe(true);
    expect(isPaymentYenAmount(PAYMENT_YEN_MAX + 1n)).toBe(false);
    expect(isPaymentYenAmount(10000000n)).toBe(false);
  });
});

describe("groupYenInput（打ったそばから3桁区切り）", () => {
  it.each([
    ["", 0, "", 0],
    ["1", 1, "1", 1],
    ["1000", 4, "1,000", 5],
    ["12000", 5, "12,000", 6],
    ["1,0000", 6, "10,000", 6],
    ["1234567", 7, "1,234,567", 9],
    ["１２０００", 5, "12,000", 6],
    // 途中に打ったとき、入力位置は数字の並びで合わせる（「1,2|00」に「5」→「12,5|00」）
    ["1,2500", 4, "12,500", 4],
    // カンマを消したとき（「1,|000」でBackspace→「1|000」）は、数字の並びのまま戻す
    ["1000", 1, "1,000", 1],
  ])("%s（位置%i）→ %s（位置%i）", (raw, caret, value, nextCaret) => {
    expect(groupYenInput(raw, caret)).toEqual({ value, caret: nextCaret });
  });

  it("前後の空白は除いて区切る（貼り付けた金額）", () => {
    expect(groupYenInput(" 1234567 ", 9)).toEqual({ value: "1,234,567", caret: 9 });
    expect(groupYenInput("　12000", 6)).toEqual({ value: "12,000", caret: 6 });
  });

  it("数字とカンマ以外が混ざれば触らない（欄の検証で誤りを出す）", () => {
    expect(groupYenInput("12a", 3)).toEqual({ value: "12a", caret: 3 });
    expect(groupYenInput("1.5", 3)).toEqual({ value: "1.5", caret: 3 });
  });
});
