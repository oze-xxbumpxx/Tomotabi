import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Trip } from "@tomotabi/contracts";

const { replaceMock } = vi.hoisted(() => ({
  replaceMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, push: vi.fn() }),
}));

import { EntryScreen } from "@/screens/entry/entry-screen";

const userId = "550e8400-e29b-41d4-a716-446655440000";
const tripId = "8a6e0804-2bd0-4672-b79d-d97027f9071a";
const selectedKey = `tomotabi:selected-trip:${userId}`;

const meBody = {
  user: { id: userId, displayName: "ひなた" },
  sessionExpiresAt: "2026-10-03T07:43:00.000Z",
};

const tripBody: Trip = {
  id: tripId,
  name: "沖縄",
  startsOn: "2026-10-12",
  endsOn: "2026-10-14",
  status: "planning",
  version: "1",
  createdAt: "2026-09-01T00:00:00.000Z",
  startedAt: null,
  finishedAt: null,
  createdBy: userId,
  startedBy: null,
  finishedBy: null,
};

function urlOf(input: RequestInfo | URL): string {
  return typeof input === "string"
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;
}

function stubApi(
  me: { status: number; body?: unknown },
  trip: { status: number; body?: unknown } = { status: 200, body: tripBody },
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = urlOf(input);
    if (url === "/api/me") {
      return new Response(
        me.body === undefined ? "" : JSON.stringify(me.body),
        { status: me.status },
      );
    }
    if (url === `/api/trips/${tripId}`) {
      return new Response(
        trip.body === undefined ? "" : JSON.stringify(trip.body),
        { status: trip.status },
      );
    }
    return new Response(JSON.stringify({ code: "NOT_FOUND" }), {
      status: 404,
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("EntryScreen (/)", () => {
  it("W-01: 保存値が有効なら前回の旅行のしおりへ", async () => {
    stubApi({ status: 200, body: meBody });
    window.localStorage.setItem(selectedKey, tripId);

    render(<EntryScreen />);

    await waitFor(() =>
      expect(replaceMock).toHaveBeenCalledWith(
        `/trips/${tripId}/itinerary`,
      ),
    );
    // 保存値は残す（次回も同じ旅行へ戻れる）。
    expect(window.localStorage.getItem(selectedKey)).toBe(tripId);
  });

  it("W-02: 保存値が 403 なら /trips へ進み保存値を消す", async () => {
    const fetchMock = stubApi(
      { status: 200, body: meBody },
      { status: 403, body: { code: "TRIP_NOT_ACCESSIBLE" } },
    );
    window.localStorage.setItem(selectedKey, tripId);

    render(<EntryScreen />);

    await waitFor(() =>
      expect(replaceMock).toHaveBeenCalledWith("/trips"),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/trips/${tripId}`,
      expect.objectContaining({ method: "GET" }),
    );
    expect(window.localStorage.getItem(selectedKey)).toBeNull();
    expect(replaceMock).not.toHaveBeenCalledWith(
      `/trips/${tripId}/itinerary`,
    );
  });

  it("W-03: 保存値が無ければ /trips へ", async () => {
    const fetchMock = stubApi({ status: 200, body: meBody });

    render(<EntryScreen />);

    await waitFor(() =>
      expect(replaceMock).toHaveBeenCalledWith("/trips"),
    );
    // 旅行の確認は送らない。
    expect(fetchMock).not.toHaveBeenCalledWith(
      `/api/trips/${tripId}`,
      expect.anything(),
    );
  });

  it("W-03: localStorage が使えなくても /trips へ（例外で止まらない）", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    stubApi({ status: 200, body: meBody });

    render(<EntryScreen />);

    await waitFor(() =>
      expect(replaceMock).toHaveBeenCalledWith("/trips"),
    );
  });

  it("401 なら /sign-in へ（再送しない）", async () => {
    const fetchMock = stubApi({ status: 401 });

    render(<EntryScreen />);

    await waitFor(() =>
      expect(replaceMock).toHaveBeenCalledWith("/sign-in"),
    );
    const meCalls = fetchMock.mock.calls.filter(
      (call) => urlOf(call[0]) === "/api/me",
    );
    expect(meCalls).toHaveLength(1);
  });

  it("503 なら一時的な利用不可を出し、再試行で進める", async () => {
    const fetchMock = stubApi({ status: 503 });

    render(<EntryScreen />);

    expect(
      await screen.findByText(/一時的に利用できません/),
    ).toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalledWith("/sign-in");

    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (urlOf(input) === "/api/me") {
        return new Response(JSON.stringify(meBody), { status: 200 });
      }
      return new Response(JSON.stringify({ code: "NOT_FOUND" }), {
        status: 404,
      });
    });
    await userEvent.click(screen.getByRole("button", { name: "再試行" }));

    await waitFor(() =>
      expect(replaceMock).toHaveBeenCalledWith("/trips"),
    );
  });

  it("契約と違う /api/me の応答はエラー表示にし、値を出さない", async () => {
    stubApi({
      status: 200,
      body: { user: { id: "not-uuid", displayName: "そうた" } },
    });

    render(<EntryScreen />);

    expect(
      await screen.findByText("情報を読み込めませんでした。"),
    ).toBeInTheDocument();
    expect(screen.queryByText("そうた")).not.toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });
});
