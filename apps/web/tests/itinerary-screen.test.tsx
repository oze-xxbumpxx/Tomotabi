import { QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Itinerary, Trip } from "@tomotabi/contracts";
import { createQueryClient } from "@/shared/api/query-client";

const { replaceMock, pushMock } = vi.hoisted(() => ({
  replaceMock: vi.fn(),
  pushMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, push: pushMock }),
}));

import { ItineraryScreen } from "@/screens/itinerary/itinerary-screen";

const userId = "550e8400-e29b-41d4-a716-446655440000";
const tripId = "8a6e0804-2bd0-4672-b79d-d97027f9071a";
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

function itineraryBody(t: Trip): Itinerary {
  return {
    trip: t,
    date: t.startsOn,
    plans: [],
    fetchedAt: "2026-09-27T12:00:00.000Z",
  };
}

function urlOf(input: RequestInfo | URL): string {
  return typeof input === "string"
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;
}

type Handler = (init?: RequestInit) => Response | Promise<Response>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function notFound(): Response {
  return json({ code: "NOT_FOUND" }, 404);
}

/**
 * /api/me と /api/trips/* を URL・メソッドで振り分ける fake。
 * ハンドラは呼ばれるたびに評価する（成功→失敗の切り替えが書ける）。
 */
function stubApi(handlers: {
  itinerary?: Handler;
  trip?: Handler;
  start?: Handler;
  finish?: Handler;
  rename?: Handler;
  period?: Handler;
}): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = urlOf(input);
    const method = init?.method ?? "GET";
    if (url === "/api/me") {
      return Promise.resolve(json(meBody));
    }
    if (url === `/api/trips/${tripId}/itinerary` && method === "GET") {
      return Promise.resolve(
        handlers.itinerary !== undefined
          ? handlers.itinerary(init)
          : json(itineraryBody(trip())),
      );
    }
    if (url === `/api/trips/${tripId}/start` && method === "POST") {
      return Promise.resolve(
        handlers.start !== undefined ? handlers.start(init) : notFound(),
      );
    }
    if (url === `/api/trips/${tripId}/finish` && method === "POST") {
      return Promise.resolve(
        handlers.finish !== undefined ? handlers.finish(init) : notFound(),
      );
    }
    if (url === `/api/trips/${tripId}/period` && method === "PUT") {
      return Promise.resolve(
        handlers.period !== undefined ? handlers.period(init) : notFound(),
      );
    }
    if (url === `/api/trips/${tripId}` && method === "PATCH") {
      return Promise.resolve(
        handlers.rename !== undefined ? handlers.rename(init) : notFound(),
      );
    }
    if (url === `/api/trips/${tripId}` && method === "GET") {
      return Promise.resolve(
        handlers.trip !== undefined ? handlers.trip(init) : json(trip()),
      );
    }
    return Promise.resolve(notFound());
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderScreen(id = tripId): void {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <ItineraryScreen tripId={id} />
    </QueryClientProvider>,
  );
}

function writeCalls(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(
    (call) => (call[1]?.method ?? "GET") !== "GET",
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe("ItineraryScreen (/trips/{id}/itinerary)", () => {
  it("ヘッダーに旅行名・期間・状態を出し、開いた旅行を「前回の旅行」に保存する", async () => {
    stubApi({});
    renderScreen();

    expect(
      await screen.findByRole("heading", { name: "沖縄" }),
    ).toBeInTheDocument();
    expect(screen.getByText("10/12 月 – 10/14 水")).toBeInTheDocument();
    expect(screen.getByText("出発前")).toBeInTheDocument();
    // 下部タブは「しおり」だけ。
    expect(
      screen.getByRole("navigation", { name: "タブ" }),
    ).toHaveTextContent("しおり");
    await waitFor(() =>
      expect(window.localStorage.getItem(selectedKey)).toBe(tripId),
    );
  });

  it.each([403, 404])(
    "W-13: 取得が %i なら同じ文言「この旅行を開けません」",
    async (status) => {
      stubApi({
        itinerary: () => json({ code: "TRIP_NOT_ACCESSIBLE" }, status),
      });
      renderScreen();

      expect(
        await screen.findByText("この旅行を開けません"),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "旅行一覧へ" }),
      ).toBeInTheDocument();
    },
  );

  it("403 なら「前回の旅行」の保存値を消す（B-09）", async () => {
    stubApi({
      itinerary: () => json({ code: "TRIP_NOT_ACCESSIBLE" }, 403),
    });
    window.localStorage.setItem(selectedKey, tripId);
    renderScreen();

    await screen.findByText("この旅行を開けません");
    await waitFor(() =>
      expect(window.localStorage.getItem(selectedKey)).toBeNull(),
    );
  });

  it("planning の旅行はメニューから開始できる", async () => {
    const fetchMock = stubApi({
      start: () =>
        json(
          trip({
            status: "traveling",
            version: "2",
            startedAt: "2026-10-12T01:00:00.000Z",
            startedBy: userId,
          }),
        ),
    });
    renderScreen();

    await screen.findByRole("heading", { name: "沖縄" });
    await userEvent.click(
      screen.getByRole("button", { name: "旅行のメニュー" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "旅行を開始する" }),
    );

    expect(
      await screen.findByText("旅行を開始しました"),
    ).toBeInTheDocument();
    const [url, init] = writeCalls(fetchMock)[0];
    expect(url).toBe(`/api/trips/${tripId}/start`);
    expect(new Headers(init?.headers).get("if-match")).toBe('"1"');
    expect(
      new Headers(init?.headers).get("idempotency-key"),
    ).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("W-22: traveling の旅行は確認してから終了する", async () => {
    const fetchMock = stubApi({
      itinerary: () =>
        json(
          itineraryBody(
            trip({ status: "traveling", startedAt: "2026-10-12T01:00:00.000Z" }),
          ),
        ),
      finish: () =>
        json(
          trip({
            status: "finished",
            version: "2",
            startedAt: "2026-10-12T01:00:00.000Z",
            finishedAt: "2026-10-14T09:00:00.000Z",
            startedBy: userId,
            finishedBy: userId,
          }),
        ),
    });
    renderScreen();

    await screen.findByRole("heading", { name: "沖縄" });
    await userEvent.click(
      screen.getByRole("button", { name: "旅行のメニュー" }),
    );
    const finishItem = screen.getByRole("button", {
      name: /旅行を終了する/,
    });
    expect(finishItem).toHaveTextContent(
      "終了後も記録・編集・精算はできます",
    );
    await userEvent.click(finishItem);

    // 確認（17）。
    expect(
      await screen.findByRole("heading", { name: "旅行を終了しますか？" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/終了後に精算できます/)).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "終了する" }),
    );

    expect(
      await screen.findByText("旅行を終了しました"),
    ).toBeInTheDocument();
    const [url, init] = writeCalls(fetchMock)[0];
    expect(url).toBe(`/api/trips/${tripId}/finish`);
    expect(new Headers(init?.headers).get("if-match")).toBe('"1"');
  });

  it("W-23: 名前と期間の両方を変えると PATCH → PUT の順に送る", async () => {
    const renamed = trip({ name: "石垣島", version: "2" });
    const moved = trip({
      name: "石垣島",
      startsOn: "2026-10-20",
      endsOn: "2026-10-22",
      version: "3",
    });
    const fetchMock = stubApi({
      rename: () => json(renamed),
      period: () => json(moved),
    });
    renderScreen();

    await screen.findByRole("heading", { name: "沖縄" });
    await userEvent.click(
      screen.getByRole("button", { name: "旅行のメニュー" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "旅行名と期間を変更" }),
    );

    fireEvent.change(screen.getByLabelText("旅行名"), {
      target: { value: "石垣島" },
    });
    fireEvent.change(screen.getByLabelText("開始日"), {
      target: { value: "2026-10-20" },
    });
    fireEvent.change(screen.getByLabelText("終了日"), {
      target: { value: "2026-10-22" },
    });
    await userEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(await screen.findByText("変更しました")).toBeInTheDocument();
    const writes = writeCalls(fetchMock);
    expect(writes).toHaveLength(2);

    const [patchUrl, patchInit] = writes[0];
    expect(patchUrl).toBe(`/api/trips/${tripId}`);
    expect(patchInit?.method).toBe("PATCH");
    expect(new Headers(patchInit?.headers).get("if-match")).toBe('"1"');
    expect(JSON.parse(String(patchInit?.body))).toEqual({ name: "石垣島" });

    const [putUrl, putInit] = writes[1];
    expect(putUrl).toBe(`/api/trips/${tripId}/period`);
    expect(putInit?.method).toBe("PUT");
    // 期間の If-Match は名前の保存が返した新しい ETag。
    expect(new Headers(putInit?.headers).get("if-match")).toBe('"2"');
    expect(JSON.parse(String(putInit?.body))).toEqual({
      startsOn: "2026-10-20",
      endsOn: "2026-10-22",
    });
  });

  it("W-23: 期間が 422 でも名前は保存済みと出し、期間の欄にエラー", async () => {
    stubApi({
      rename: () => json(trip({ name: "石垣島", version: "2" })),
      period: () =>
        json({ code: "PLAN_OUTSIDE_TRIP_PERIOD" }, 422),
    });
    renderScreen();

    await screen.findByRole("heading", { name: "沖縄" });
    await userEvent.click(
      screen.getByRole("button", { name: "旅行のメニュー" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "旅行名と期間を変更" }),
    );

    fireEvent.change(screen.getByLabelText("旅行名"), {
      target: { value: "石垣島" },
    });
    fireEvent.change(screen.getByLabelText("開始日"), {
      target: { value: "2026-10-01" },
    });
    await userEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(
      await screen.findByText("旅行名は保存済みです"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "この期間に入らない予定があります。予定の日付を先に変更してください",
      ),
    ).toBeInTheDocument();
    // シートは開いたまま（保存済みの結果を隠さない）。
    expect(
      screen.getByRole("heading", { name: "旅行名と期間を変更" }),
    ).toBeInTheDocument();
  });

  it("401 は業務データを隠して「もう一度ログインしてください」", async () => {
    stubApi({
      itinerary: () => json({ code: "UNAUTHENTICATED" }, 401),
    });
    renderScreen();

    expect(
      await screen.findByText("もう一度ログインしてください"),
    ).toBeInTheDocument();
    expect(screen.queryByText("沖縄")).not.toBeInTheDocument();
  });
});
