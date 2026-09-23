import type { ProbeView as ContractProbeView } from "@tomotabi/contracts";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { getProbe, incrementProbe } from "@/features/foundation/api/probe-api";
import type { ProbeView as GeneratedProbeView } from "@/shared/api/generated/foundation";

afterEach(() => {
  vi.unstubAllGlobals();
});

function respondWith(body: string, status = 200): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue(new Response(body, { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("probe API", () => {
  it("calls the generated GET route", async () => {
    const fetchMock = respondWith(JSON.stringify({ count: 4 }));

    const result = await getProbe();

    expect(result._unsafeUnwrap()).toEqual({ count: 4 });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/foundation/probes");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "GET" });
  });

  it("calls the generated POST route", async () => {
    const fetchMock = respondWith(JSON.stringify({ count: 5 }));

    const result = await incrementProbe();

    expect(result._unsafeUnwrap()).toEqual({ count: 5 });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/foundation/probes/increment");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "POST" });
  });

  it.each([
    ["zero", { count: 0 }, 0],
    ["a positive integer", { count: 4 }, 4],
    ["extra properties", { count: 1, extra: true }, 1],
  ])("accepts %s", async (_label, body, expected) => {
    respondWith(JSON.stringify(body));

    expect((await getProbe())._unsafeUnwrap().count).toBe(expected);
  });

  it.each([
    ["a negative count", { count: -1 }],
    ["a decimal count", { count: 1.5 }],
    ["a numeric string", { count: "4" }],
    ["a missing count", {}],
    ["a null count", { count: null }],
  ])("rejects %s as a validation failure", async (_label, body) => {
    respondWith(JSON.stringify(body));

    expect((await getProbe())._unsafeUnwrapErr()).toEqual({ kind: "validation" });
  });

  it("keeps HTTP, network and invalid-JSON failures distinct", async () => {
    respondWith("boom", 500);
    expect((await getProbe())._unsafeUnwrapErr()).toEqual({ kind: "http", status: 500 });

    respondWith("not json");
    expect((await getProbe())._unsafeUnwrapErr()).toEqual({ kind: "invalid-json" });

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    expect((await getProbe())._unsafeUnwrapErr()).toEqual({ kind: "network" });
  });

  it("keeps the generated and published ProbeView types compatible", () => {
    expectTypeOf<GeneratedProbeView>().toEqualTypeOf<ContractProbeView>();
  });
});
