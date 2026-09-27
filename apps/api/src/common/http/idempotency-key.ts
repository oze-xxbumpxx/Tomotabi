import { ApiError } from "./api-error";

export type IdempotencyKey = string & { readonly __brand: "IdempotencyKey" };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Idempotency-Key ヘッダー（UUID）を解析する。利用者・操作単位の再送識別子で、
 * 欠落も形式違反も 400 INVALID_REQUEST。
 * @throws 欠落・UUID でないとき ApiError（400 INVALID_REQUEST）を投げる。
 */
export function parseIdempotencyKey(value: string | undefined): IdempotencyKey {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new ApiError({
      code: "INVALID_REQUEST",
      status: 400,
      message: "Idempotency-Key must be a UUID",
    });
  }
  return value as IdempotencyKey;
}
