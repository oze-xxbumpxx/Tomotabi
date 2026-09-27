import { ApiError } from "./api-error";

/**
 * 強い ETag。引用付きの 10 進の正整数（version）。`"3"` の形だけを受け付ける。
 */
export type StrongETag = string & { readonly __brand: "StrongETag" };

const IF_MATCH_PATTERN = /^"([1-9][0-9]*)"$/;

/**
 * version（正の整数）を引用付きの強い ETag にする。
 */
export function toStrongETag(version: number | bigint | string): StrongETag {
  return `"${String(version)}"` as StrongETag;
}

/**
 * If-Match ヘッダーを解析し、比較用の version（10 進の正整数の文字列）を返す。
 * 弱い ETag・`*`・複数値・引用なし・非正の整数は形式違反。
 * @throws 欠落は 428 IF_MATCH_REQUIRED、形式違反は 400 INVALID_REQUEST。
 */
export function parseIfMatch(value: string | undefined): string {
  if (value === undefined) {
    throw new ApiError({
      code: "IF_MATCH_REQUIRED",
      status: 428,
      message: "If-Match header is required",
    });
  }
  const match = IF_MATCH_PATTERN.exec(value);
  if (match === null) {
    throw new ApiError({
      code: "INVALID_REQUEST",
      status: 400,
      message: "If-Match must be a single strong entity tag",
    });
  }
  return match[1]!;
}
