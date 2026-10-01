export type PaymentYen = bigint & { readonly __brand: "PaymentYen" };
export type SignedYen = bigint & { readonly __brand: "SignedYen" };

// 支払い額の範囲（要件 F-02: 1〜9,999,999 円。正本の 999,999,999 円から下げた値）
const PAYMENT_MIN = 1n;
const PAYMENT_MAX = 9_999_999n;

// wire の形式（契約の pattern）と揃える。先頭ゼロ・"+100"・"-0" は受け付けない
const UNSIGNED_DECIMAL_PATTERN = /^(0|[1-9][0-9]*)$/;
const SIGNED_DECIMAL_PATTERN = /^(0|-?[1-9][0-9]*)$/;

export const PaymentYen = {
  /**
   * 支払い額を 10 進の整数文字列から作る。Number を通さない。
   * @throws 10 進でない・1〜9,999,999 円の範囲外のとき Error を投げる。
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

  /** 10 進の整数文字列に戻す（wire 形式）。 */
  toDecimalString(value: PaymentYen): string {
    return value.toString(10);
  },
};

export const SignedYen = {
  ZERO: 0n as SignedYen,

  /**
   * 符号付きの円を 10 進の整数文字列から作る（`"-3500"`・`"0"`・`"7001"`）。
   * Number を通さない。
   * @throws 10 進の整数でないとき Error を投げる。
   */
  parse(value: string): SignedYen {
    if (!SIGNED_DECIMAL_PATTERN.test(value)) {
      throw new Error("SignedYen must be a signed decimal integer string");
    }
    return BigInt(value) as SignedYen;
  },

  /**
   * bigint の計算結果を包む。符号付きの円には範囲の規則を持たせない
   * （負担額・寄与・合計のどれも計算で生まれる値で、上限は支払い額側の規則が担う）。
   */
  fromBigInt(value: bigint): SignedYen {
    return value as SignedYen;
  },

  /** 10 進の整数文字列に戻す（wire 形式。負は `-` 付き）。 */
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
