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
  ifMatch: '"3"',
};

describe("createMutationRequest", () => {
  it("fixes the request as one set with a fresh UUID idempotency key", () => {
    const request = createMutationRequest(draft);

    expect(request).toMatchObject({
      operation: "rename-trip",
      url: "/api/trips/trip-1",
      method: "PATCH",
      body: { name: "京都 2 泊" },
      ifMatch: '"3"',
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

  it("defaults ifMatch to null", () => {
    const { ifMatch: _ifMatch, ...noMatch } = draft;
    expect(createMutationRequest(noMatch).ifMatch).toBeNull();
  });
});

const tripSchema = z.object({ id: z.string(), name: z.string() });

function stubFetch(response: Response): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("sendMutationRequest", () => {
  it("sends method, url, JSON body, Idempotency-Key and If-Match unchanged", async () => {
    const request = createMutationRequest(draft);
    const fetchMock = stubFetch(
      new Response(JSON.stringify({ id: "trip-1", name: "京都 2 泊" }), {
        status: 200,
        headers: { ETag: '"4"' },
      }),
    );

    const result = await sendMutationRequest(request, tripSchema);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/trips/trip-1");
    expect(init.method).toBe("PATCH");
    expect(init.body).toBe(JSON.stringify({ name: "京都 2 泊" }));
    const headers = new Headers(init.headers);
    expect(headers.get("idempotency-key")).toBe(request.idempotencyKey);
    expect(headers.get("if-match")).toBe('"3"');
    expect(result.isOk() && result.value).toEqual({
      data: { id: "trip-1", name: "京都 2 泊" },
      status: 200,
      etag: '"4"',
    });
  });

  it("omits If-Match and the body when they are null", async () => {
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
    expect(headers.has("if-match")).toBe(false);
    expect(init.body).toBeUndefined();
  });

  it("sends the identical key, body and If-Match when the same request is resent", async () => {
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
    expect(secondHeaders.get("if-match")).toBe(firstHeaders.get("if-match"));
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
