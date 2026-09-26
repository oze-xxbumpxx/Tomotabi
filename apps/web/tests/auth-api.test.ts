import type { Me as ContractMe } from "@tomotabi/contracts";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { getMe } from "@/features/auth/api/me-api";
import type { Me as GeneratedMe } from "@/shared/api/generated/auth";

afterEach(() => {
  vi.unstubAllGlobals();
});

const meJson = JSON.stringify({
  user: { id: "550e8400-e29b-41d4-a716-446655440000", displayName: "ひなた" },
  sessionExpiresAt: "2026-10-03T07:43:00.000Z",
});

function respondWith(body: string, status = 200): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue(new Response(body, { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("me API", () => {
  it("calls the generated GET /api/me route with cookies", async () => {
    const fetchMock = respondWith(meJson);

    const result = await getMe();

    expect(result._unsafeUnwrap()).toEqual(JSON.parse(meJson));
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/me");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "GET",
      credentials: "include",
    });
  });

  it.each([401, 403, 503])(
    "keeps HTTP %d as an http failure with its status",
    async (status) => {
      respondWith(
        JSON.stringify({ code: "X", message: "m", requestId: "r" }),
        status,
      );

      expect((await getMe())._unsafeUnwrapErr()).toEqual({
        kind: "http",
        status,
      });
    },
  );

  it.each([
    ["a wrong id format", { user: { id: "not-uuid", displayName: "x" }, sessionExpiresAt: "2026-10-03T07:43:00.000Z" }],
    ["a missing displayName", { user: { id: "550e8400-e29b-41d4-a716-446655440000" }, sessionExpiresAt: "2026-10-03T07:43:00.000Z" }],
    ["a missing sessionExpiresAt", { user: { id: "550e8400-e29b-41d4-a716-446655440000", displayName: "x" } }],
  ])("rejects %s as a validation failure", async (_label, body) => {
    respondWith(JSON.stringify(body));

    expect((await getMe())._unsafeUnwrapErr()).toEqual({ kind: "validation" });
  });

  it("keeps the generated and published Me types compatible", () => {
    expectTypeOf<GeneratedMe>().toEqualTypeOf<ContractMe>();
  });
});
