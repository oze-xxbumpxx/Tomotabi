import { afterEach, describe, expect, it, vi } from "vitest";
import { apiGet, ApiError } from "@/shared/api/http-client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("http-client", () => {
  it("sends cookies and parses JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ count: 4 }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiGet("/api/foundation/probes")).resolves.toEqual({
      count: 4,
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/foundation/probes", {
      credentials: "include",
      cache: "no-store",
    });
  });

  it("throws ApiError on a non-OK response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => "boom",
      }),
    );

    await expect(apiGet("/api/health")).rejects.toBeInstanceOf(ApiError);
  });
});
