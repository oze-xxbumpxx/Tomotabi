import type { ResultAsync } from "neverthrow";
import type { ZodType } from "zod";
import type { ApiFailure } from "./api-failure";
import { callApiWithMeta, type ApiSuccess } from "./api-result";
import { httpClient } from "./http-client";

/**
 * 送信の直前に1組として固定する書き込みの要求。
 * `bodyJson`は本文をJSON文字列にしたもの（nullは本文なし）。
 * 送信後に呼び出し側が元のオブジェクトを変えても、ここに入った文字列は変わらない。
 */
export type MutationRequest = {
  operation: string;
  url: string;
  method: "POST" | "PATCH" | "PUT";
  bodyJson: string | null;
  /** If-Matchに付ける値（ETag）。不要な操作はnull。 */
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
 * 要求を1組で固定し、Idempotency-Keyを新しく採番する。
 * 結果不明のあとの確認は、この返り値をそのまま`sendMutationRequest`に渡す
 * （キー・本文・If-Matchを変えて送り直さない）。入力を変えた送信は別の要求として作り直す。
 */
export function createMutationRequest(
  draft: MutationDraft,
): MutationRequest {
  return {
    operation: draft.operation,
    url: draft.url,
    method: draft.method,
    bodyJson:
      draft.body === null || draft.body === undefined
        ? null
        : JSON.stringify(draft.body),
    ifMatch: draft.ifMatch ?? null,
    idempotencyKey: crypto.randomUUID(),
  };
}

/**
 * 固定した要求をそのまま送り、成功応答をZodで検証してETagと一緒に返す。
 * 同じ`request`を渡す限り、キー・本文・If-Matchは変わらない。
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
        body: request.bodyJson === null ? undefined : request.bodyJson,
      },
    ),
    schema,
  );
}
