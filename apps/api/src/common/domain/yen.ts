export type PaymentYen = bigint & { readonly __brand: "PaymentYen" };
export type SignedYen = bigint & { readonly __brand: "SignedYen" };

// 支払い額の範囲（要件F-02: 1〜9,999,999円。正本の999,999,999円から下げた値）
const PAYMENT_MIN = 1n;
const PAYMENT_MAX = 9_999_999n;

// wireの形式（契約のpattern）と揃える。先頭ゼロ・"+100"・"-0"は受け付けない
const UNSIGNED_DECIMAL_PATTERN = /^(0|[1-9][0-9]*)$/;
const SIGNED_DECIMAL_PATTERN = /^(0|-?[1-9][0-9]*)$/;

export const PaymentYen = {
  /**
   * 支払い額を10進の整数文字列から作る。Numberを通さない。
   * @throws 10進でない・1〜9,999,999円の範囲外のときErrorを投げる。
   */
  parse(value: string): PaymentYen {
    if (!UNSIGNED_DECIMAL_PATTERN.test(value)) {
      throw new Error("PaymentYen must be a decimal integer string");
    }
    const parsed = BigInt(value);
    if (parsed < PAYMENT_MIN || parsed > PAYMENT_MAX) {
      throw new Error("PaymentYen must be between 1 and 9999999");
    }
    return parsed as PaymentYen;
  },

  /** 10進の整数文字列に戻す（wire形式）。 */
  toDecimalString(value: PaymentYen): string {
    return value.toString(10);
  },
};

export const SignedYen = {
  ZERO: 0n as SignedYen,

  /**
   * 符号付きの円を10進の整数文字列から作る（`"-3500"`・`"0"`・`"7001"`）。
   * Numberを通さない。
   * @throws 10進の整数でないときErrorを投げる。
   */
  parse(value: string): SignedYen {
    if (!SIGNED_DECIMAL_PATTERN.test(value)) {
      throw new Error("SignedYen must be a signed decimal integer string");
    }
    return BigInt(value) as SignedYen;
  },

  /**
   * bigintの計算結果を包む。符号付きの円には範囲の規則を持たせない
   * （負担額・寄与・合計のどれも計算で生まれる値で、上限は支払い額側の規則が担う）。
   */
  fromBigInt(value: bigint): SignedYen {
    return value as SignedYen;
  },

  /** 10進の整数文字列に戻す（wire形式。負は`-`付き）。 */
  toDecimalString(value: SignedYen): string {
    return value.toString(10);
  },

  add(a: SignedYen, b: SignedYen): SignedYen {
    return (a + b) as SignedYen;
  },

  negate(value: SignedYen): SignedYen {
    return -value as SignedYen;
  },
};
