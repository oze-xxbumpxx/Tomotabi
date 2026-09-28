import { errAsync, okAsync, ResultAsync } from "neverthrow";
import type { ZodType } from "zod";
import { ApiRequestError, type ApiFailure } from "./api-failure";

function toApiFailure(cause: unknown): ApiFailure {
  if (cause instanceof ApiRequestError) {
    return cause.failure;
  }
  return { kind: "network" };
}

/**
 * 生成関数の Promise を Result に取り込み、応答本文を Zod で検証する。
 * 検証を通った値だけが Ok になる。例外は外へ投げない。
 */
export function callApi<T>(
  request: Promise<{ data: unknown }>,
  schema: ZodType<T>,
): ResultAsync<T, ApiFailure> {
  return ResultAsync.fromPromise(request, toApiFailure).andThen((response) => {
    const parsed = schema.safeParse(response.data);
    return parsed.success
      ? okAsync(parsed.data)
      : errAsync<T, ApiFailure>({ kind: "validation" });
  });
}

export type ApiSuccess<T> = {
  data: T;
  status: number;
  /** 成功応答の ETag ヘッダー。無ければ null。 */
  etag: string | null;
};

/**
 * callApi と同じ検証をし、検証済みの data に加えて status と ETag を返す。
 * 書き込みの成功応答（ETag を次の If-Match に使う）に使う。
 */
export function callApiWithMeta<T>(
  request: Promise<{ data: unknown; status: number; headers: Headers }>,
  schema: ZodType<T>,
): ResultAsync<ApiSuccess<T>, ApiFailure> {
  return ResultAsync.fromPromise(request, toApiFailure).andThen((response) => {
    const parsed = schema.safeParse(response.data);
    return parsed.success
      ? okAsync<ApiSuccess<T>, ApiFailure>({
          data: parsed.data,
          status: response.status,
          etag: response.headers.get("etag"),
        })
      : errAsync<ApiSuccess<T>, ApiFailure>({ kind: "validation" });
  });
}
