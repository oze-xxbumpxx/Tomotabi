import { ApiRequestError, isApiErrorCode } from "./api-failure";

/**
 * 読む要求（GET）を失敗とみなすまでの時間。応答が返らないと、読み込み中の
 * 骨組みが出たままになり、再試行も出せないため（#251）。書き込みは結果が
 * 分からなくなるので切らない。
 */
export const READ_TIMEOUT_MS = 15_000;

/** 呼び出し側の中断と、時間切れのどちらでも止まる印を作る。 */
function withReadTimeout(signal: AbortSignal | null | undefined): {
  signal: AbortSignal;
  clear: () => void;
} {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), READ_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  if (signal?.aborted === true) {
    controller.abort();
  } else {
    signal?.addEventListener("abort", onAbort, { once: true });
  }
  return {
    signal: controller.signal,
    clear: () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    },
  };
}

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
 * 2xxかつJSON本文のときだけ`{ data, status, headers }`を返す。`data`は未検証なので、
 * 呼び出し側（`callApi`）でZod検証するまで信頼しない。
 * 非2xxでは本文から既知のcodeだけを取り出して`http`に載せる。message・requestIdは取り出さない。
 * GETは`READ_TIMEOUT_MS`で切り、通信失敗（network）として扱う。
 * @throws ApiRequestError通信失敗（network）、非2xx（http）、空またはJSONでない本文（invalid-json）
 */
export async function httpClient<T>(url: string, options: RequestInit): Promise<T> {
  const method = (options.method ?? "GET").toUpperCase();
  const headers = new Headers(options.headers);
  if (method !== "GET" && method !== "HEAD") {
    headers.set("content-type", "application/json");
  }

  const timeout =
    method === "GET" || method === "HEAD" ? withReadTimeout(options.signal) : null;
  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      method,
      headers,
      credentials: "include",
      cache: "no-store",
      ...(timeout === null ? {} : { signal: timeout.signal }),
    });
  } catch {
    throw new ApiRequestError({ kind: "network" });
  } finally {
    timeout?.clear();
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
  } as T;
}
