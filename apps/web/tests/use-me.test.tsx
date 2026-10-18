import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMe } from "@/features/auth/model/use-me";
import { ApiRequestError } from "@/shared/api/api-failure";
import { createQueryClient } from "@/shared/api/query-client";

function wrapperFor(client = createQueryClient()) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

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

    const { result } = renderHook(() => useMe(), { wrapper: wrapperFor() });

    expect(result.current.state.status).toBe("loading");
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    expect(result.current.state).toEqual({ status: "ready", me: meBody });
  });

  it("maps 401 to unauthenticated", async () => {
    stubMe(401);

    const { result } = renderHook(() => useMe(), { wrapper: wrapperFor() });

    await waitFor(() =>
      expect(result.current.state.status).toBe("unauthenticated"),
    );
  });

  it("maps 503 to unavailable", async () => {
    stubMe(503);

    const { result } = renderHook(() => useMe(), { wrapper: wrapperFor() });

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

    const { result } = renderHook(() => useMe(), { wrapper: wrapperFor() });

    await waitFor(() => expect(result.current.state.status).toBe("error"));
  });

  it("reload fetches again and clear resets to loading", async () => {
    const fetchMock = stubMe(503);

    const { result } = renderHook(() => useMe(), { wrapper: wrapperFor() });
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

  it("2つの画面で続けて使っても、/api/me は1回しか取らない（SS-T05）", async () => {
    const fetchMock = stubMe(200);
    const client = createQueryClient();

    const first = renderHook(() => useMe(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(first.result.current.state.status).toBe("ready"));
    first.unmount();

    const second = renderHook(() => useMe(), { wrapper: wrapperFor(client) });
    expect(second.result.current.state.status).toBe("ready");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("ログアウトでキャッシュを消すと、次は取り直す（SS-T05）", async () => {
    const fetchMock = stubMe(200);
    // 応答の本文は1回しか読めないので、呼ばれるたびに新しく作る
    fetchMock.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify(meBody), { status: 200 })),
    );
    const client = createQueryClient();

    const first = renderHook(() => useMe(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(first.result.current.state.status).toBe("ready"));
    first.unmount();
    client.clear();

    const second = renderHook(() => useMe(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(second.result.current.state.status).toBe("ready"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("業務のデータの取得で401を受けると、使い回していた情報を消す（SS-T05）", async () => {
    stubMe(200);
    const client = createQueryClient();
    const { result } = renderHook(
      () => {
        const me = useMe();
        const other = useQuery({
          queryKey: ["trips"],
          queryFn: (): Promise<never> =>
            Promise.reject(
              new ApiRequestError({ kind: "http", status: 401, code: null }),
            ),
          enabled: me.state.status === "ready",
        });
        return { me, other };
      },
      { wrapper: wrapperFor(client) },
    );
    await waitFor(() => expect(result.current.other.isError).toBe(true));
    expect(client.getQueryData(["me"])).toBeUndefined();
  });
});
