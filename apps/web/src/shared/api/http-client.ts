import { ApiRequestError, isApiErrorCode } from "./api-failure";

async function readErrorCode(response: Response) {
  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null && "code" in body) {
      const code = (body as { code: unknown }).code;
      return isApiErrorCode(code) ? code : null;
    }
  } catch {
    // 本文がJSONでなければcodeは取り出さない。
  }
  return null;
}

/**
 * Orvalのcustom mutator。生成関数から呼ばれる。
 * 2xxかつJSON本文のときだけ`{ data, status, headers, etag }`を返す。`data`は未検証なので、
 * 呼び出し側（`callApi`）でZod検証するまで信頼しない。`etag`は成功応答のETagヘッダー（無ければnull）。
 * 非2xxでは本文から既知のcodeだけを取り出して`http`に載せる。message・requestIdは取り出さない。
 * @throws ApiRequestError通信失敗（network）、非2xx（http）、空またはJSONでない本文（invalid-json）
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

  // 204は本文を持たない応答（購読の無効化など）。空本文として扱う。
  if (response.status === 204) {
    return {
      data: null,
      status: response.status,
      headers: response.headers,
      etag: null,
    } as T;
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
