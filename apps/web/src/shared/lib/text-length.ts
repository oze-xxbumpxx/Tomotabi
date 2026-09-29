/**
 * 文字数の数え方はサーバーの BoundedText と同じコードポイント数。
 * UTF-16 の `.length` では絵文字を 2 と数えるため、こちらを使う。
 */
export function codePointLength(text: string): number {
  return Array.from(text).length;
}

/**
 * 前後の空白を除いたあとのコードポイント数。
 * 「空白だけなら 0」の検証に使う。
 */
export function boundedTextLength(text: string): number {
  return codePointLength(text.trim());
}
