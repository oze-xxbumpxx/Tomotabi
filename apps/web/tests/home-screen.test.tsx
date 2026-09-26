import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const { replaceMock, signOutMock } = vi.hoisted(() => ({
  replaceMock: vi.fn(),
  signOutMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock }),
}));

vi.mock("@/shared/auth/auth-client", () => ({
  authClient: { signOut: signOutMock },
}));

import { HomeScreen } from "@/screens/home/home-screen";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const meBody = {
  user: { id: "550e8400-e29b-41d4-a716-446655440000", displayName: "ひなた" },
  sessionExpiresAt: "2026-10-03T07:43:00.000Z",
};

/**
 * /api/me と foundation の probe を URL で振り分ける fake。
 * me の body に undefined を渡すと空 body を返す（status が 2xx 以外なら本文は読まれない）。
 */
function stubApi(me: { status: number; body?: unknown }): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    if (url === "/api/me") {
      return new Response(
        me.body === undefined ? "" : JSON.stringify(me.body),
        { status: me.status },
      );
    }
    return new Response(JSON.stringify({ count: 0 }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function meCalls(fetchMock: ReturnType<typeof vi.fn>): number {
  return fetchMock.mock.calls.filter((call) => call[0] === "/api/me").length;
}

describe("HomeScreen", () => {
  it("W-04: shows the display name and a sign-out button", async () => {
    stubApi({ status: 200, body: meBody });

    render(<HomeScreen />);

    expect(await screen.findByText("ひなた")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "ログアウト" }),
    ).toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("W-05: replaces to /sign-in on 401 without resending", async () => {
    const fetchMock = stubApi({ status: 401 });

    render(<HomeScreen />);

    await waitFor(() =>
      expect(replaceMock).toHaveBeenCalledWith("/sign-in"),
    );
    expect(meCalls(fetchMock)).toBe(1);
  });

  it("W-06: shows a temporary-unavailable message and retries on 503", async () => {
    const fetchMock = stubApi({ status: 503 });

    render(<HomeScreen />);

    expect(
      await screen.findByText(/一時的に利用できません/),
    ).toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
    expect(screen.queryByText("ひなた")).not.toBeInTheDocument();

    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      if (url === "/api/me") {
        return new Response(JSON.stringify(meBody), { status: 200 });
      }
      return new Response(JSON.stringify({ count: 0 }), { status: 200 });
    });
    await userEvent.click(screen.getByRole("button", { name: "再試行" }));

    expect(await screen.findByText("ひなた")).toBeInTheDocument();
    expect(meCalls(fetchMock)).toBe(2);
  });

  it("W-07: shows an error and no unvalidated value on a contract violation", async () => {
    stubApi({
      status: 200,
      body: { user: { id: "not-uuid", displayName: "そうた" } },
    });

    render(<HomeScreen />);

    expect(
      await screen.findByText("情報を読み込めませんでした。"),
    ).toBeInTheDocument();
    expect(screen.queryByText("そうた")).not.toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("W-08: clears the screen state and goes to /sign-in on sign-out", async () => {
    signOutMock.mockResolvedValue({ data: { success: true }, error: null });
    stubApi({ status: 200, body: meBody });

    render(<HomeScreen />);
    expect(await screen.findByText("ひなた")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "ログアウト" }));

    await waitFor(() =>
      expect(replaceMock).toHaveBeenCalledWith("/sign-in"),
    );
    expect(signOutMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("ひなた")).not.toBeInTheDocument();
  });
});
