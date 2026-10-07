import "fake-indexeddb/auto";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Itinerary, Trip } from "@tomotabi/contracts";
import {
  itineraryQueryKey,
  START_TRIP_OPERATION,
} from "@/features/trips";
import { createMutationRequest } from "@/shared/api/mutation-request";
import { createQueryClient } from "@/shared/api/query-client";
import {
  savePendingRequest,
  toPendingRequestRecord,
} from "@/shared/browser/pending-requests";

const { replaceMock, pushMock, signOutMock } = vi.hoisted(() => ({
  replaceMock: vi.fn(),
  pushMock: vi.fn(),
  signOutMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, push: pushMock }),
}));

vi.mock("@/shared/auth/auth-client", () => ({
  authClient: { signOut: signOutMock },
}));

import ItineraryPage from "@/app/trips/[tripId]/itinerary/page";
import { ItineraryScreen } from "@/screens/itinerary/itinerary-screen";
import {
  setPendingToast,
  takePendingToast,
} from "@/shared/lib/pending-toast";

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
 * /api/meと /api/trips/* をURL・メソッドで振り分けるfake。
 * ハンドラは呼ばれるたびに評価する（成功→失敗の切り替えが書ける）。
 */
function stubApi(handlers: {
  me?: Handler;
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
      return Promise.resolve(
        handlers.me !== undefined ? handlers.me(init) : json(meBody),
      );
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

function renderScreen(
  id = tripId,
  client = createQueryClient(),
): void {
  render(
    <QueryClientProvider client={client}>
      <ItineraryScreen tripId={id} />
    </QueryClientProvider>,
  );
}

function writeCalls(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(
    (call) => (call[1]?.method ?? "GET") !== "GET",
  );
}

async function resetDb(): Promise<void> {
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase("tomotabi");
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

/** 端末に残した保留の照合が終わるまで待ってから押す。 */
async function clickWhenEnabled(name: string | RegExp) {
  const button = await screen.findByRole("button", { name });
  await waitFor(() => expect(button).toBeEnabled());
  await userEvent.click(button);
}

afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  window.localStorage.clear();
  await resetDb();
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
    // 下部タブは4つと「支払いを記録」。「しおり」にだけ aria-current。
    const nav = screen.getByRole("navigation", { name: "タブ" });
    for (const [label, href] of [
      ["ホーム", `/trips/${tripId}/home`],
      ["記録", `/trips/${tripId}/records`],
      ["精算", `/trips/${tripId}/settlement`],
    ] as const) {
      expect(
        within(nav).getByRole("link", { name: label }),
      ).toHaveAttribute("href", href);
    }
    // 今のタブはリンクではなく、aria-current="page" の項目。
    expect(within(nav).queryByRole("link", { name: "しおり" })).toBeNull();
    expect(nav.querySelector('[aria-current="page"]')).toHaveTextContent(
      "しおり",
    );
    expect(
      screen.getByRole("link", { name: "支払いを記録" }),
    ).toHaveAttribute("href", `/trips/${tripId}/payments/new`);
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

  it("URL の date が日付の形でなければ date なし（サーバー既定）で取る", async () => {
    const fetchMock = stubApi({});
    render(
      <QueryClientProvider client={createQueryClient()}>
        {await ItineraryPage({
          params: Promise.resolve({ tripId }),
          searchParams: Promise.resolve({ date: "abc" }),
        })}
      </QueryClientProvider>,
    );

    await screen.findByRole("heading", { name: "沖縄" });
    const itineraryCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).startsWith(`/api/trips/${tripId}/itinerary`),
    );
    expect(itineraryCalls).toHaveLength(1);
    expect(String(itineraryCalls[0][0])).not.toContain("date=");
  });

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
    await clickWhenEnabled("旅行を開始する");

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
    await clickWhenEnabled("終了する");

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
    await clickWhenEnabled("保存");

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
    // 期間のIf-Matchは名前の保存が返した新しいETag。
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
    await clickWhenEnabled("保存");

    expect(
      await screen.findByText("旅行名は保存済みです"),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(
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

  it("W-12: 表示の後の再取得が 401 でも表示済みのデータを隠して C-1", async () => {
    let itineraryCalls = 0;
    stubApi({
      itinerary: () => {
        itineraryCalls += 1;
        return itineraryCalls === 1
          ? json(itineraryBody(trip()))
          : json({ code: "UNAUTHENTICATED" }, 401);
      },
    });
    const client = createQueryClient();
    renderScreen(tripId, client);

    expect(
      await screen.findByRole("heading", { name: "沖縄" }),
    ).toBeInTheDocument();

    await act(async () => {
      await client.invalidateQueries({ queryKey: itineraryQueryKey(tripId) });
    });

    expect(
      await screen.findByText("もう一度ログインしてください"),
    ).toBeInTheDocument();
    expect(screen.queryByText("沖縄")).not.toBeInTheDocument();
  });

  it("ログアウトでキャッシュと表示名を消して /sign-in へ", async () => {
    let itineraryCalls = 0;
    stubApi({
      itinerary: () => {
        itineraryCalls += 1;
        if (itineraryCalls === 1) {
          return json(itineraryBody(trip()));
        }
        // ログアウト後にキャッシュから描画されないことを確かめるため保留にする。
        return new Promise<Response>(() => {});
      },
    });
    signOutMock.mockResolvedValue({
      data: { success: true },
      error: null,
    });
    const client = createQueryClient();
    renderScreen(tripId, client);

    await screen.findByRole("heading", { name: "沖縄" });
    await userEvent.click(
      screen.getByRole("button", { name: "旅行のメニュー" }),
    );
    expect(
      screen.getByText("ひなた としてログイン中"),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: /ログアウト/ }),
    );

    await waitFor(() =>
      expect(replaceMock).toHaveBeenCalledWith("/sign-in"),
    );
    expect(client.getQueryData(itineraryQueryKey(tripId))).toBeUndefined();
    expect(screen.queryByText(/ひなた/)).not.toBeInTheDocument();
    expect(screen.queryByText("沖縄")).not.toBeInTheDocument();
  });

  it("ログアウトすると未表示のトーストを捨てる", async () => {
    stubApi({});
    signOutMock.mockResolvedValue({
      data: { success: true },
      error: null,
    });
    renderScreen();

    await screen.findByRole("heading", { name: "沖縄" });
    // 保存成功の直後、遷移先でまだ出していないトーストがある状態。
    act(() => setPendingToast("変更しました"));
    await userEvent.click(
      screen.getByRole("button", { name: "旅行のメニュー" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: /ログアウト/ }),
    );

    await waitFor(() =>
      expect(replaceMock).toHaveBeenCalledWith("/sign-in"),
    );
    // 次に開いた画面が取り出す受け皿が空なら、古いトーストは出ない。
    expect(takePendingToast()).toBeNull();
  });

  it("利用者が取れなくてもログアウトを押せる（失敗は既存の表示）", async () => {
    stubApi({
      me: () => json({ code: "INTERNAL_ERROR" }, 500),
    });
    signOutMock.mockResolvedValue({
      data: null,
      error: { status: 503 },
    });
    renderScreen();

    await screen.findByRole("heading", { name: "沖縄" });
    await userEvent.click(
      screen.getByRole("button", { name: "旅行のメニュー" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: /ログアウト/ }),
    );

    await waitFor(() => expect(signOutMock).toHaveBeenCalled());
    expect(
      await screen.findByText(
        "ログアウトできませんでした。もう一度お試しください。",
      ),
    ).toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalledWith("/sign-in");
  });

  it.each(["start", "rename"] as const)(
    "書き込みが 403 で拒否されたら「この旅行を開けません」（%s）",
    async (target) => {
      stubApi(
        target === "start"
          ? { start: () => json({ code: "TRIP_NOT_ACCESSIBLE" }, 403) }
          : { rename: () => json({ code: "TRIP_NOT_ACCESSIBLE" }, 403) },
      );
      renderScreen();

      await screen.findByRole("heading", { name: "沖縄" });
      await userEvent.click(
        screen.getByRole("button", { name: "旅行のメニュー" }),
      );
      if (target === "start") {
        await clickWhenEnabled("旅行を開始する");
      } else {
        await userEvent.click(
          screen.getByRole("button", { name: "旅行名と期間を変更" }),
        );
        fireEvent.change(screen.getByLabelText("旅行名"), {
          target: { value: "石垣島" },
        });
        await clickWhenEnabled("保存");
      }

      expect(
        await screen.findByText("この旅行を開けません"),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "旅行一覧へ" }),
      ).toBeInTheDocument();
      expect(screen.queryByText("沖縄")).not.toBeInTheDocument();
    },
  );

  it("開始が 428 なら古い ETag で再送せず、閉じると最新を取り直す", async () => {
    let itineraryCalls = 0;
    const fetchMock = stubApi({
      itinerary: () => {
        itineraryCalls += 1;
        return json(itineraryBody(trip({ version: String(itineraryCalls) })));
      },
      start: () => json({ code: "IF_MATCH_REQUIRED" }, 428),
    });
    renderScreen();

    await screen.findByRole("heading", { name: "沖縄" });
    await userEvent.click(
      screen.getByRole("button", { name: "旅行のメニュー" }),
    );
    await clickWhenEnabled("旅行を開始する");

    expect(
      await screen.findByText("画面を更新してからやり直してください"),
    ).toBeInTheDocument();
    // 古いETagのままの再送ボタンは出さない。
    expect(
      screen.queryByRole("button", { name: "やり直す" }),
    ).not.toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: "閉じる" }),
    );

    await waitFor(() => expect(itineraryCalls).toBe(2));
    const writes = writeCalls(fetchMock);
    expect(writes).toHaveLength(1);
  });

  it("W-23: 期間が 422 のあと期間だけ直して再保存すると直近の応答の ETag で送る", async () => {
    let periodCalls = 0;
    const fetchMock = stubApi({
      rename: () => json(trip({ name: "石垣島", version: "2" })),
      period: () => {
        periodCalls += 1;
        if (periodCalls === 1) {
          return json({ code: "PLAN_OUTSIDE_TRIP_PERIOD" }, 422);
        }
        return json(
          trip({
            name: "石垣島",
            startsOn: "2026-10-20",
            endsOn: "2026-10-22",
            version: "3",
          }),
        );
      },
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
    await clickWhenEnabled("保存");

    expect(
      await screen.findByText("旅行名は保存済みです"),
    ).toBeInTheDocument();
    // 「旅行名は保存済みです」は1回目の期間の送信が終わる前にも出る。
    // 422が返るのを待ってから直さないと、送信中の2回目の保存は受け付けられない。
    expect(
      await screen.findByText(
        "この期間に入らない予定があります。予定の日付を先に変更してください",
      ),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("開始日"), {
      target: { value: "2026-10-20" },
    });
    fireEvent.change(screen.getByLabelText("終了日"), {
      target: { value: "2026-10-22" },
    });
    await clickWhenEnabled("保存");

    expect(await screen.findByText("変更しました")).toBeInTheDocument();
    const puts = writeCalls(fetchMock).filter(
      ([url]) => url === `/api/trips/${tripId}/period`,
    );
    expect(puts).toHaveLength(2);
    // 2回目のPUTは、名前の保存が返したETag（しおりの再取得を待たない）。
    expect(new Headers(puts[1][1]?.headers).get("if-match")).toBe('"2"');
  });

  it("RW-03: 開始の保留があれば「保存されたか確認できません」を出し、同じキーで送り直す", async () => {
    const record = toPendingRequestRecord({
      userId,
      tripId,
      request: createMutationRequest({
        operation: START_TRIP_OPERATION,
        url: `/api/trips/${tripId}/start`,
        method: "POST",
        body: null,
        ifMatch: '"1"',
      }),
    });
    await savePendingRequest(record);
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

    // 保留があるあいだは新しい送信は押せず、確認の案内だけ出す。
    expect(
      await screen.findByText("保存されたか確認できません"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "旅行を開始する" }),
    ).toBeDisabled();

    await userEvent.click(
      screen.getByRole("button", { name: "同じ内容で確認する" }),
    );

    expect(
      await screen.findByText("旅行を開始しました"),
    ).toBeInTheDocument();
    const [url, init] = writeCalls(fetchMock)[0];
    expect(url).toBe(`/api/trips/${tripId}/start`);
    // 同じ要求（同じ冪等キー・同じETag）をそのまま送り直す。
    expect(new Headers(init?.headers).get("idempotency-key")).toBe(
      record.idempotencyKey,
    );
    expect(new Headers(init?.headers).get("if-match")).toBe('"1"');
  });
});
