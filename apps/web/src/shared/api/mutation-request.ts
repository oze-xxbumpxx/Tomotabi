import type { ResultAsync } from "neverthrow";
import type { ZodType } from "zod";
import type { ApiFailure } from "./api-failure";
import { callApiWithMeta, type ApiSuccess } from "./api-result";
import { httpClient } from "./http-client";

/**
 * 送信の直前に 1 組として固定する書き込みの要求。
 * `body` が null のときは本文を送らない。
 */
export type MutationRequest = {
  operation: string;
  url: string;
  method: "POST" | "PATCH" | "PUT";
  body: unknown;
  /** If-Match に付ける値（ETag）。不要な操作は null。 */
  ifMatch: string | null;
  idempotencyKey: string;
};

export type MutationDraft = {
  operation: string;
  url: string;
  method: MutationRequest["method"];
  body: unknown;
  ifMatch?: string | null;
};

/**
 * 要求を 1 組で固定し、Idempotency-Key を新しく採番する。
 * 結果不明のあとの確認は、この返り値をそのまま `sendMutationRequest` に渡す
 * （キー・本文・If-Match を変えて送り直さない）。入力を変えた送信は別の要求として作り直す。
 */
export function createMutationRequest(
  draft: MutationDraft,
): MutationRequest {
  return {
    operation: draft.operation,
    url: draft.url,
    method: draft.method,
    body: draft.body,
    ifMatch: draft.ifMatch ?? null,
    idempotencyKey: crypto.randomUUID(),
  };
}

/**
 * 固定した要求をそのまま送り、成功応答を Zod で検証して ETag と一緒に返す。
 * 同じ `request` を渡す限り、キー・本文・If-Match は変わらない。
 */
export function sendMutationRequest<T>(
  request: MutationRequest,
  schema: ZodType<T>,
): ResultAsync<ApiSuccess<T>, ApiFailure> {
  const headers: Record<string, string> = {
    "idempotency-key": request.idempotencyKey,
  };
  if (request.ifMatch !== null) {
    headers["if-match"] = request.ifMatch;
  }
  return callApiWithMeta(
    httpClient<{ data: unknown; status: number; headers: Headers }>(
      request.url,
      {
        method: request.method,
        headers,
        body:
          request.body === null ? undefined : JSON.stringify(request.body),
      },
    ),
    schema,
  );
}
