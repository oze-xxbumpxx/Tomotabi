import { ApiRequestError } from "./api-failure";

/**
 * Orval の custom mutator。生成関数から呼ばれる。
 * 2xx かつ JSON 本文のときだけ `{ data, status, headers }` を返す。`data` は未検証なので、
 * 呼び出し側（`callApi`）で Zod 検証するまで信頼しない。
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
    throw new ApiRequestError({ kind: "http", status: response.status });
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

  return { data, status: response.status, headers: response.headers } as T;
}
