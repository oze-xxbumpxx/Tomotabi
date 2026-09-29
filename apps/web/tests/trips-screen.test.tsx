import { QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Trip, TripPage } from "@tomotabi/contracts";
import { createQueryClient } from "@/shared/api/query-client";

const { replaceMock, pushMock } = vi.hoisted(() => ({
  replaceMock: vi.fn(),
  pushMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, push: pushMock }),
}));

import { TripsScreen } from "@/screens/trips/trips-screen";

const userId = "550e8400-e29b-41d4-a716-446655440000";
const tripId = "8a6e0804-2bd0-4672-b79d-d97027f9071a";
const otherTripId = "a1b2c3d4-1111-4222-8333-444455556666";
const selectedKey = `tomotabi:selected-trip:${userId}`;

const meBody = {
  user: { id: userId, displayName: "ひなた" },
  sessionExpiresAt: "2026-10-03T07:43:00.000Z",
};

function trip(overrides: Partial<Trip> = {}): Trip {
  return {
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
    ...overrides,
  };
}

function urlOf(input: RequestInfo | URL): string {
  return typeof input === "string"
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;
}

function stubApi(
  me: { status: number; body?: unknown },
  trips: (url: string, init?: RequestInit) => Response | Promise<Response>,
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = urlOf(input);
    if (url === "/api/me") {
      return Promise.resolve(
        new Response(
          me.body === undefined ? "" : JSON.stringify(me.body),
          { status: me.status },
        ),
      );
    }
    if (url.startsWith("/api/trips")) {
      return Promise.resolve(trips(url, init));
    }
    return Promise.resolve(
      new Response(JSON.stringify({ code: "NOT_FOUND" }), { status: 404 }),
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function page(items: Trip[], nextCursor: string | null = null): TripPage {
  return { items, nextCursor };
}

function renderScreen(client = createQueryClient()): void {
  render(
    <QueryClientProvider client={client}>
      <TripsScreen />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe("TripsScreen (/trips)", () => {
  it("W-05: 旅行 0 件なら空表示と「新しい旅行をつくる」", async () => {
    stubApi({ status: 200, body: meBody }, () =>
      new Response(JSON.stringify(page([])), { status: 200 }),
    );

    renderScreen();

    expect(
      await screen.findByText("旅行はまだありません"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "新しい旅行をつくる" }),
    ).toHaveAttribute("href", "/trips/new");
  });

  it("一覧に行を出し、前回開いた旅行に印を付ける", async () => {
    stubApi({ status: 200, body: meBody }, () =>
      new Response(
        JSON.stringify(
          page([
            trip(),
            trip({ id: otherTripId, name: "金沢", status: "finished" }),
          ]),
        ),
        { status: 200 },
      ),
    );
    window.localStorage.setItem(selectedKey, tripId);

    renderScreen();

    const selected = await screen.findByRole("link", { name: /沖縄/ });
    expect(selected).toHaveAttribute(
      "href",
      `/trips/${tripId}/itinerary`,
    );
    expect(selected).toHaveTextContent("前回開いた旅行");
    expect(
      screen.getByRole("link", { name: /金沢/ }),
    ).not.toHaveTextContent("前回開いた旅行");
    // 状態は色だけでなく文字で出す。
    expect(screen.getByText("出発前")).toBeInTheDocument();
    expect(screen.getByText("終了")).toBeInTheDocument();
  });

  it("最初の取得が失敗したら「取得できませんでした」と再試行", async () => {
    let tripsCalls = 0;
    const fetchMock = stubApi({ status: 200, body: meBody }, () => {
      tripsCalls += 1;
      if (tripsCalls === 1) {
        return new Response(JSON.stringify({ code: "INTERNAL_ERROR" }), {
          status: 500,
        });
      }
      return new Response(JSON.stringify(page([trip()])), { status: 200 });
    });

    renderScreen();

    expect(
      await screen.findByText("取得できませんでした"),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "再試行" }));
    expect(await screen.findByRole("link", { name: /沖縄/ })).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.filter((call) =>
        urlOf(call[0]).startsWith("/api/trips"),
      ),
    ).toHaveLength(2);
  });

  it("一覧の取得が 401 なら業務データを隠してログインを促す", async () => {
    stubApi({ status: 200, body: meBody }, () =>
      new Response(JSON.stringify({ code: "UNAUTHENTICATED" }), {
        status: 401,
      }),
    );

    renderScreen();

    expect(
      await screen.findByText("もう一度ログインしてください"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/沖縄/)).not.toBeInTheDocument();
  });

  it("W-12: 表示の後の再取得が 401 でも表示済みのデータを隠して C-1", async () => {
    let tripsCalls = 0;
    stubApi({ status: 200, body: meBody }, () => {
      tripsCalls += 1;
      return tripsCalls === 1
        ? new Response(JSON.stringify(page([trip()])), { status: 200 })
        : new Response(JSON.stringify({ code: "UNAUTHENTICATED" }), {
            status: 401,
          });
    });
    const client = createQueryClient();
    renderScreen(client);

    expect(
      await screen.findByRole("link", { name: /沖縄/ }),
    ).toBeInTheDocument();

    await act(async () => {
      await client.invalidateQueries();
    });

    expect(
      await screen.findByText("もう一度ログインしてください"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/沖縄/)).not.toBeInTheDocument();
  });

  it("旅行 0 件でも再取得中・再取得の失敗を出す", async () => {
    let tripsCalls = 0;
    stubApi({ status: 200, body: meBody }, () => {
      tripsCalls += 1;
      if (tripsCalls === 1) {
        return new Response(JSON.stringify(page([])), { status: 200 });
      }
      return new Response(JSON.stringify({ code: "INTERNAL_ERROR" }), {
        status: 500,
      });
    });
    const client = createQueryClient();
    renderScreen(client);

    expect(
      await screen.findByText("旅行はまだありません"),
    ).toBeInTheDocument();

    await act(async () => {
      await client.invalidateQueries();
    });

    expect(
      await screen.findByText(/更新できていません/),
    ).toBeInTheDocument();
    // 空の表示はそのまま残す（失敗を 0 件と混ぜない）。
    expect(screen.getByText("旅行はまだありません")).toBeInTheDocument();
  });

  it("/api/me が 401 なら /sign-in へ", async () => {
    stubApi({ status: 401 }, () =>
      new Response(JSON.stringify(page([])), { status: 200 }),
    );

    renderScreen();

    await waitFor(() =>
      expect(replaceMock).toHaveBeenCalledWith("/sign-in"),
    );
  });
});
