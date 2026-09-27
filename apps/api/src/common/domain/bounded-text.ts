export type BoundedText = string & { readonly __brand: "BoundedText" };

function codePointLength(value: string): number {
  return [...value].length;
}

export const BoundedText = {
  /**
   * 前後の空白を除き、1〜maxCodePoints コードポイントの文字列を作る。
   * 長さは UTF-16 ではなく Unicode コードポイントで数える。
   * @throws 空白だけ・空・上限超過のとき Error を投げる。
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
   * メモなど省略可の項目用。未指定・空白だけ・空は null、それ以外は parse と同じ規則。
   * @throws 上限超過のとき Error を投げる。
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
