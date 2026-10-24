import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  createMutationRequest,
  sendMutationRequest,
} from "@/shared/api/mutation-request";

afterEach(() => {
  vi.unstubAllGlobals();
});

const draft = {
  operation: "rename-trip",
  url: "/api/trips/trip-1",
  method: "PATCH" as const,
  body: { name: "京都 2 泊" },
  expectedVersion: "3",
};

describe("createMutationRequest", () => {
  it("fixes the request as one set with a fresh UUID idempotency key", () => {
    const request = createMutationRequest(draft);

    expect(request).toMatchObject({
      operation: "rename-trip",
      url: "/api/trips/trip-1",
      method: "PATCH",
      bodyJson: JSON.stringify({ name: "京都 2 泊" }),
      expectedVersion: "3",
    });
    expect(request.idempotencyKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("assigns a different key to each new request", () => {
    const first = createMutationRequest(draft);
    const second = createMutationRequest(draft);

    expect(first.idempotencyKey).not.toBe(second.idempotencyKey);
  });

  it("defaults expectedVersion to null", () => {
    const { expectedVersion: _version, ...noVersion } = draft;
    expect(createMutationRequest(noVersion).expectedVersion).toBeNull();
  });
});

const tripSchema = z.object({ id: z.string(), name: z.string() });

function stubFetch(response: Response): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("sendMutationRequest", () => {
  it("sends method, url, JSON body, Idempotency-Key and X-Expected-Version unchanged", async () => {
    const request = createMutationRequest(draft);
    const fetchMock = stubFetch(
      new Response(JSON.stringify({ id: "trip-1", name: "京都 2 泊" }), {
        status: 200,
      }),
    );

    const result = await sendMutationRequest(request, tripSchema);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/trips/trip-1");
    expect(init.method).toBe("PATCH");
    expect(init.body).toBe(JSON.stringify({ name: "京都 2 泊" }));
    const headers = new Headers(init.headers);
    expect(headers.get("idempotency-key")).toBe(request.idempotencyKey);
    expect(headers.get("x-expected-version")).toBe("3");
    // If-Matchを付けると、Vercelの層が成功の応答を412に置き換える。
    expect(headers.has("if-match")).toBe(false);
    expect(result.isOk() && result.value).toEqual({
      data: { id: "trip-1", name: "京都 2 泊" },
      status: 200,
    });
  });

  it("omits X-Expected-Version and the body when they are null", async () => {
    const request = createMutationRequest({
      operation: "start-trip",
      url: "/api/trips/trip-1/start",
      method: "POST",
      body: null,
    });
    const fetchMock = stubFetch(
      new Response(JSON.stringify({ id: "trip-1", name: "x" })),
    );

    await sendMutationRequest(request, tripSchema);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.has("x-expected-version")).toBe(false);
    expect(headers.has("if-match")).toBe(false);
    expect(init.body).toBeUndefined();
  });

  it("sends the frozen body even if the caller mutates the original object", async () => {
    const body = { name: "京都 2 泊" };
    const request = createMutationRequest({ ...draft, body });
    body.name = "あとから変えた名前";

    const fetchMock = stubFetch(
      new Response(JSON.stringify({ id: "trip-1", name: "京都 2 泊" })),
    );
    await sendMutationRequest(request, tripSchema);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBe(JSON.stringify({ name: "京都 2 泊" }));
  });

  it("sends the identical key, body and version when the same request is resent", async () => {
    const request = createMutationRequest(draft);
    const fetchMock = stubFetch(
      new Response(JSON.stringify({ id: "trip-1", name: "京都 2 泊" })),
    );

    await sendMutationRequest(request, tripSchema);
    await sendMutationRequest(request, tripSchema);

    const [first, second] = fetchMock.mock.calls as [
      [string, RequestInit],
      [string, RequestInit],
    ];
    const firstHeaders = new Headers(first[1].headers);
    const secondHeaders = new Headers(second[1].headers);
    expect(secondHeaders.get("idempotency-key")).toBe(
      firstHeaders.get("idempotency-key"),
    );
    expect(secondHeaders.get("x-expected-version")).toBe(firstHeaders.get("x-expected-version"));
    expect(second[1].body).toBe(first[1].body);
    expect(second[0]).toBe(first[0]);
  });

  it("fails with the validation failure kind on a contract-violating body", async () => {
    stubFetch(new Response(JSON.stringify({ id: 1, name: 2 })));
    const request = createMutationRequest(draft);

    const result = await sendMutationRequest(request, tripSchema);

    expect(result.isErr() && result.error).toEqual({ kind: "validation" });
  });
});
