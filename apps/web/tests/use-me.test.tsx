import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMe } from "@/features/auth/model/use-me";

afterEach(() => {
  vi.unstubAllGlobals();
});

const meBody = {
  user: { id: "550e8400-e29b-41d4-a716-446655440000", displayName: "ひなた" },
  sessionExpiresAt: "2026-10-03T07:43:00.000Z",
};

function stubMe(status: number, body: unknown = meBody): ReturnType<typeof vi.fn> {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(
      new Response(body === undefined ? "" : JSON.stringify(body), { status }),
    );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("useMe", () => {
  it("loads the current user (ready)", async () => {
    stubMe(200);

    const { result } = renderHook(() => useMe());

    expect(result.current.state.status).toBe("loading");
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    expect(result.current.state).toEqual({ status: "ready", me: meBody });
  });

  it("maps 401 to unauthenticated", async () => {
    stubMe(401);

    const { result } = renderHook(() => useMe());

    await waitFor(() =>
      expect(result.current.state.status).toBe("unauthenticated"),
    );
  });

  it("maps 503 to unavailable", async () => {
    stubMe(503);

    const { result } = renderHook(() => useMe());

    await waitFor(() =>
      expect(result.current.state.status).toBe("unavailable"),
    );
  });

  it.each([
    ["a contract-violating body", 200, { user: { id: "not-uuid" } }],
    ["a network failure", "reject", null],
    ["another http failure", 403, null],
  ])("maps %s to error", async (_label, status, body) => {
    if (status === "reject") {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
      );
    } else {
      stubMe(status as number, body === null ? { code: "X" } : body);
    }

    const { result } = renderHook(() => useMe());

    await waitFor(() => expect(result.current.state.status).toBe("error"));
  });

  it("reload fetches again and clear resets to loading", async () => {
    const fetchMock = stubMe(503);

    const { result } = renderHook(() => useMe());
    await waitFor(() =>
      expect(result.current.state.status).toBe("unavailable"),
    );

    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(meBody), { status: 200 }),
    );
    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.state).toEqual({ status: "ready", me: meBody });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    act(() => result.current.clear());
    expect(result.current.state.status).toBe("loading");
  });
});
