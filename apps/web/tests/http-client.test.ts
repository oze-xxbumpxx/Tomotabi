import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "@/shared/api/api-failure";
import { httpClient } from "@/shared/api/http-client";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(response: Response): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function failureOf(request: Promise<unknown>): Promise<unknown> {
  const error = await request.then(
    () => null,
    (cause: unknown) => cause,
  );
  expect(error).toBeInstanceOf(ApiRequestError);
  return (error as ApiRequestError).failure;
}

describe("httpClient", () => {
  it("sends cookies without cache and returns unvalidated data", async () => {
    const fetchMock = stubFetch(new Response(JSON.stringify({ count: 4 })));

    const result = await httpClient<{ data: unknown; status: number }>("/api/foundation/probes", {
      method: "GET",
    });

    expect(result).toMatchObject({ data: { count: 4 }, status: 200, etag: null });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/foundation/probes");
    expect(init).toMatchObject({ method: "GET", credentials: "include", cache: "no-store" });
    expect(new Headers(init.headers).has("content-type")).toBe(false);
  });

  it("returns the ETag response header on success", async () => {
    stubFetch(
      new Response(JSON.stringify({ version: 3 }), {
        headers: { ETag: '"3"' },
      }),
    );

    const result = await httpClient<{ data: unknown; etag: string | null }>(
      "/api/trips/abc",
      { method: "GET" },
    );

    expect(result.etag).toBe('"3"');
  });

  it("adds a JSON content type to a body-less POST", async () => {
    const fetchMock = stubFetch(new Response(JSON.stringify({ count: 5 })));

    await httpClient("/api/foundation/probes/increment", { method: "POST" });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
  });

  it("classifies a rejected fetch as a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    expect(await failureOf(httpClient("/api/health", { method: "GET" }))).toEqual({
      kind: "network",
    });
  });

  it("classifies a non-2xx response as an HTTP failure with its status", async () => {
    stubFetch(new Response("boom", { status: 500 }));

    expect(await failureOf(httpClient("/api/health", { method: "GET" }))).toEqual({
      kind: "http",
      status: 500,
      code: null,
    });
  });

  it("extracts a known code from the error body", async () => {
    stubFetch(
      new Response(
        JSON.stringify({
          code: "VERSION_CONFLICT",
          message: "バージョンが古いです",
          requestId: "req-secret-1",
          retryable: false,
        }),
        { status: 409 },
      ),
    );

    const failure = await failureOf(
      httpClient("/api/trips/abc", { method: "PATCH" }),
    );

    expect(failure).toEqual({
      kind: "http",
      status: 409,
      code: "VERSION_CONFLICT",
    });
    // message・requestIdは取り出さない（画面に出さない方針）。
    expect(JSON.stringify(failure)).not.toContain("バージョンが古いです");
    expect(JSON.stringify(failure)).not.toContain("req-secret-1");
  });

  it.each([
    ["an unknown code", { code: "SOME_NEW_CODE" }, null],
    ["a non-string code", { code: 42 }, null],
    ["a body without code", { message: "oops" }, null],
  ])(
    "maps %s in the error body to null",
    async (_label, body, expectedCode) => {
      stubFetch(new Response(JSON.stringify(body), { status: 422 }));

      expect(
        await failureOf(httpClient("/api/trips", { method: "POST" })),
      ).toEqual({ kind: "http", status: 422, code: expectedCode });
    },
  );

  it("maps a non-JSON error body to a null code", async () => {
    stubFetch(new Response("not json", { status: 400 }));

    expect(
      await failureOf(httpClient("/api/trips", { method: "POST" })),
    ).toEqual({ kind: "http", status: 400, code: null });
  });

  it.each([
    ["an empty body", ""],
    ["a non-JSON body", "not json"],
  ])("classifies %s as invalid JSON", async (_label, body) => {
    stubFetch(new Response(body));

    expect(await failureOf(httpClient("/api/health", { method: "GET" }))).toEqual({
      kind: "invalid-json",
    });
  });
});
