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
 * 生成関数のPromiseをResultに取り込み、応答本文をZodで検証する。
 * 検証を通った値だけがOkになる。例外は外へ投げない。
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
  /** 成功応答のETagヘッダー。無ければnull。 */
  etag: string | null;
};

/**
 * callApiと同じ検証をし、検証済みのdataに加えてstatusとETagを返す。
 * 書き込みの成功応答（ETagを次のIf-Matchに使う）に使う。
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
