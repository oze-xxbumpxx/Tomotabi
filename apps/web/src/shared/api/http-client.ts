import { ApiRequestError, isApiErrorCode } from "./api-failure";

async function readErrorCode(response: Response) {
  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null && "code" in body) {
      const code = (body as { code: unknown }).code;
      return isApiErrorCode(code) ? code : null;
    }
  } catch {
    // 本文が JSON でなければ code は取り出さない。
  }
  return null;
}

/**
 * Orval の custom mutator。生成関数から呼ばれる。
 * 2xx かつ JSON 本文のときだけ `{ data, status, headers, etag }` を返す。`data` は未検証なので、
 * 呼び出し側（`callApi`）で Zod 検証するまで信頼しない。`etag` は成功応答の ETag ヘッダー（無ければ null）。
 * 非 2xx では本文から既知の code だけを取り出して `http` に載せる。message・requestId は取り出さない。
 * @throws ApiRequestError 通信失敗（network）、非 2xx（http）、空または JSON でない本文（invalid-json）
 */
export async function httpClient<T>(url: string, options: RequestInit): Promise<T> {
  const method = (options.method ?? "GET").toUpperCase();
  const headers = new Headers(options.headers);
  if (method !== "GET" && method !== "HEAD") {
    headers.set("content-type", "application/json");
  }

  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      method,
      headers,
      credentials: "include",
      cache: "no-store",
    });
  } catch {
    throw new ApiRequestError({ kind: "network" });
  }

  if (!response.ok) {
    const code = await readErrorCode(response);
    throw new ApiRequestError({ kind: "http", status: response.status, code });
  }

  const text = await response.text();
  if (text === "") {
    throw new ApiRequestError({ kind: "invalid-json" });
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ApiRequestError({ kind: "invalid-json" });
  }

  return {
    data,
    status: response.status,
    headers: response.headers,
    etag: response.headers.get("etag"),
  } as T;
}
