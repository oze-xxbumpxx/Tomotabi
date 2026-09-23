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
