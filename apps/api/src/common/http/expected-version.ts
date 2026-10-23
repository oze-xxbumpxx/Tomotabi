import { ApiError } from "./api-error.js";

const EXPECTED_VERSION_PATTERN = /^[1-9][0-9]*$/;

/**
 * X-Expected-Versionヘッダーを解析し、比較用のversion（10進の正整数の文字列）を返す。
 * If-Matchは読まない。Vercelの層が、If-Matchの付いた要求の成功の応答を412に
 * 置き換えるため（応答にETagが無くても置き換える。2026-10-23に結合検証環境で確認）。
 * 0・負・引用符付き・前後の空白・複数値は形式違反。
 * @throws欠落は428 EXPECTED_VERSION_REQUIRED、形式違反は400 INVALID_REQUEST。
 */
export function parseExpectedVersion(value: string | undefined): string {
  if (value === undefined) {
    throw new ApiError({
      code: "EXPECTED_VERSION_REQUIRED",
      status: 428,
      message: "X-Expected-Version header is required",
    });
  }
  if (!EXPECTED_VERSION_PATTERN.test(value)) {
    throw new ApiError({
      code: "INVALID_REQUEST",
      status: 400,
      message: "X-Expected-Version must be a single positive integer",
    });
  }
  return value;
}
