export type BoundedText = string & { readonly __brand: "BoundedText" };

function codePointLength(value: string): number {
  return [...value].length;
}

export const BoundedText = {
  /**
   * 前後の空白を除き、1〜maxCodePointsコードポイントの文字列を作る。
   * 長さはUTF-16ではなくUnicodeコードポイントで数える。
   * @throws空白だけ・空・上限超過のときErrorを投げる。
   */
  parse(value: string, maxCodePoints: number): BoundedText {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      throw new Error("BoundedText must not be blank");
    }
    if (codePointLength(trimmed) > maxCodePoints) {
      throw new Error(`BoundedText must be at most ${maxCodePoints} code points`);
    }
    return trimmed as BoundedText;
  },

  /**
   * メモなど省略可の項目用。未指定・空白だけ・空はnull、それ以外はparseと同じ規則。
   * @throws上限超過のときErrorを投げる。
   */
  parseOptional(
    value: string | null | undefined,
    maxCodePoints: number,
  ): BoundedText | null {
    if (value === null || value === undefined || value.trim().length === 0) {
      return null;
    }
    return BoundedText.parse(value, maxCodePoints);
  },
};
