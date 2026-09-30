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
import type { Itinerary, Plan, Trip } from "@tomotabi/contracts";
import { createQueryClient } from "@/shared/api/query-client";
import { takePendingToast } from "@/shared/lib/pending-toast";

const { replaceMock, pushMock, backMock } = vi.hoisted(() => ({
  replaceMock: vi.fn(),
  pushMock: vi.fn(),
  backMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: replaceMock,
    push: pushMock,
    back: backMock,
  }),
}));

vi.mock("@/shared/auth/auth-client", () => ({
  authClient: { signOut: vi.fn() },
}));

import { ItineraryScreen } from "@/screens/itinerary/itinerary-screen";
import { PlanDetailScreen } from "@/screens/plan-detail/plan-detail-screen";
import { PlanFormScreen } from "@/screens/plan-form/plan-form-screen";

const userId = "550e8400-e29b-41d4-a716-446655440000";
const otherUserId = "3f7c1f68-9c05-4f2e-9b4c-2d5b1a90f811";
const tripId = "8a6e0804-2bd0-4672-b79d-d97027f9071a";
const planId = "6d6a86a1-6d0b-4c0f-9bb9-9a1d3a9e9c01";
const secondPlanId = "11111111-2222-4333-8444-555555555555";
const thirdPlanId = "66666666-7777-4888-8999-000000000000";
const eventId = "aa1d8e52-1c4a-4d6e-9a67-9d2f0a44cc01";
const eventId2 = "bb2e9f63-2d5b-4e7f-8b78-0e3f1b55dd02";
const kindIds = {
  place: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  food: "5af0a5e0-1b2c-4d3e-8f9a-0b1c2d3e4f5a",
  shopping: "2d26e1f0-6c3d-4a5b-9c7e-1f2a3b4c5d6e",
  lodging: "8e9f0a1b-2c3d-4e5f-a6b7-c8d9e0f1a2b3",
  transport: "0f1e2d3c-4b5a-6c7d-8e9f-a0b1c2d3e4f5",
  cancelled: "1a2b3c4d-5e6f-4a8b-9c0d-e1f2a3b4c5d6",
} as const;

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

function plan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: planId,
    tripId,
    name: "錦市場で昼食",
    kind: "food",
    date: "2026-10-13",
    time: "12:00",
    memo: null,
    cancelledAt: null,
    cancelledBy: null,
    version: "1",
    achievement: null,
    booking: null,
    canChangeKind: true,
    kindChangeReason: null,
    ...overrides,
  };
}

function itineraryBody(t: Trip, plans: Plan[], date = t.startsOn): Itinerary {
  return {
    trip: t,
    date,
    plans,
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

/** /api/me と /api/trips/* を URL・メソッドで振り分ける fake。 */
function stubApi(handlers: {
  me?: Handler;
  itinerary?: Handler;
  trip?: Handler;
  plan?: Handler;
  create?: Handler;
  patch?: Handler;
  move?: Handler;
  cancel?: Handler;
}): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = urlOf(input);
    const method = init?.method ?? "GET";
    if (url === "/api/me") {
      return Promise.resolve(
        handlers.me !== undefined ? handlers.me(init) : json(meBody),
      );
    }
    if (url.startsWith(`/api/trips/${tripId}/itinerary`) && method === "GET") {
      return Promise.resolve(
        handlers.itinerary !== undefined
          ? handlers.itinerary(init)
          : json(itineraryBody(trip(), [])),
      );
    }
    if (url === `/api/trips/${tripId}` && method === "GET") {
      return Promise.resolve(
        handlers.trip !== undefined ? handlers.trip(init) : json(trip()),
      );
    }
    if (url === `/api/trips/${tripId}/plans` && method === "POST") {
      return Promise.resolve(
        handlers.create !== undefined ? handlers.create(init) : notFound(),
      );
    }
    if (
      url === `/api/trips/${tripId}/plans/${planId}/move` &&
      method === "POST"
    ) {
      return Promise.resolve(
        handlers.move !== undefined ? handlers.move(init) : notFound(),
      );
    }
    if (
      url === `/api/trips/${tripId}/plans/${planId}/cancel` &&
      method === "POST"
    ) {
      return Promise.resolve(
        handlers.cancel !== undefined ? handlers.cancel(init) : notFound(),
      );
    }
    if (
      url === `/api/trips/${tripId}/plans/${planId}` &&
      method === "PATCH"
    ) {
      return Promise.resolve(
        handlers.patch !== undefined ? handlers.patch(init) : notFound(),
      );
    }
    if (
      url === `/api/trips/${tripId}/plans/${planId}` &&
      method === "GET"
    ) {
      return Promise.resolve(
        handlers.plan !== undefined ? handlers.plan(init) : json(plan()),
      );
    }
    return Promise.resolve(notFound());
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
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

describe("ItineraryScreen の予定一覧（08）", () => {
  it("予定を時刻・種類・状態の文字で並べ、各予定は詳細へのリンク", async () => {
    const plans = [
      plan({ id: planId, name: "錦市場で昼食", time: "12:00" }),
      plan({
        id: secondPlanId,
        name: "美ら海水族館",
        kind: "place",
        time: null,
        booking: {
          id: eventId,
          tripId,
          planId: secondPlanId,
          kind: "booking",
          createdBy: otherUserId,
          createdAt: "2026-10-10T20:14:00.000Z",
          cancellation: null,
        },
      }),
      plan({
        id: thirdPlanId,
        name: "国際通り",
        kind: "shopping",
        time: "15:00",
        achievement: {
          id: eventId2,
          tripId,
          planId: thirdPlanId,
          kind: "achievement",
          createdBy: userId,
          createdAt: "2026-10-13T15:00:00.000Z",
          cancellation: null,
        },
      }),
    ];
    const fetchMock = stubApi({
      itinerary: () =>
        json(itineraryBody(trip(), plans, "2026-10-13")),
    });
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ItineraryScreen tripId={tripId} date="2026-10-13" />
      </QueryClientProvider>,
    );

    expect(
      await screen.findByRole("heading", { name: "沖縄" }),
    ).toBeInTheDocument();
    // ?date= は取得にそのまま渡る。
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).includes("itinerary?date=2026-10-13"),
      ),
    ).toBe(true);

    // 日付バーの選択は aria-current で出る。
    expect(
      screen.getByRole("link", { name: /2 日目/ }),
    ).toHaveAttribute("aria-current", "date");

    // 2 日目の一覧（時刻未定は「未定」）。
    expect(screen.getByText("錦市場で昼食")).toBeInTheDocument();
    expect(screen.getByText("未定")).toBeInTheDocument();
    expect(screen.getByText("予約")).toBeInTheDocument();
    expect(screen.getByText("達成 · ひなた")).toBeInTheDocument();
    // 予定名は詳細へのリンク（戻り用の from を持つ）。
    const link = screen.getByRole("link", { name: /錦市場で昼食/ });
    expect(link).toHaveAttribute(
      "href",
      `/trips/${tripId}/plans/${planId}?from=2026-10-13`,
    );
    // 追加導線は選んだ日を引き継ぐ。
    expect(
      screen.getByRole("link", { name: /予定を追加/ }),
    ).toHaveAttribute(
      "href",
      `/trips/${tripId}/plans/new?date=2026-10-13`,
    );
  });

  it("W-16: 5 種類・同時刻・時刻未定・取りやめを試験データで並べる", async () => {
    // 試験計画 W-16: 種類 5 件ずつ。09:00 が 2 件（同時刻は応答の順）、
    // 時刻未定 1 件（後ろ）、取りやめ済み 1 件。
    const plans = [
      plan({ id: kindIds.place, name: "美ら海水族館", kind: "place", time: "09:00" }),
      plan({ id: kindIds.food, name: "朝食", kind: "food", time: "09:00" }),
      plan({ id: kindIds.transport, name: "移動", kind: "transport", time: "12:00" }),
      plan({
        id: kindIds.cancelled,
        name: "シュノーケル",
        kind: "place",
        time: "15:00",
        cancelledAt: "2026-10-13T09:00:00.000Z",
        cancelledBy: userId,
      }),
      plan({ id: kindIds.shopping, name: "お土産", kind: "shopping", time: "18:00" }),
      plan({ id: kindIds.lodging, name: "宿", kind: "lodging", time: null }),
    ];
    stubApi({
      itinerary: () => json(itineraryBody(trip(), plans, "2026-10-13")),
    });
    const { container } = render(
      <QueryClientProvider client={createQueryClient()}>
        <ItineraryScreen tripId={tripId} date="2026-10-13" />
      </QueryClientProvider>,
    );

    await screen.findByText("美ら海水族館");
    // 並びは応答の順（時刻昇順・同時刻は応答順・未定は後ろ）をそのまま出す。
    const names = Array.from(
      container.querySelectorAll(".plan-item-name"),
    ).map((el) => el.textContent);
    expect(names).toEqual([
      "美ら海水族館",
      "朝食",
      "移動",
      "シュノーケル",
      "お土産",
      "宿",
    ]);
    // 5 種類はすべて文字で示す。
    for (const label of ["場所", "食べ処", "移動", "宿", "買い物"]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    // 時刻未定は「未定」。取りやめは文字とアイコンで示す（色だけではない）。
    expect(screen.getByText("未定")).toBeInTheDocument();
    expect(screen.getByText("取りやめ")).toBeInTheDocument();
    expect(
      container.querySelector("svg.plan-marker-cancel"),
    ).not.toBeNull();
    const cancelledName = screen.getByText("シュノーケル");
    expect(cancelledName.className).toContain("plan-item-name-cancelled");
  });

  it("0 件の日は「この日の予定はまだありません」", async () => {
    stubApi({});
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ItineraryScreen tripId={tripId} />
      </QueryClientProvider>,
    );

    expect(
      await screen.findByText("この日の予定はまだありません"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /予定を追加/ }),
    ).toHaveAttribute("href", `/trips/${tripId}/plans/new?date=2026-10-12`);
  });

  it("date 省略は date なしで取り、応答の日を選択にする", async () => {
    const fetchMock = stubApi({
      itinerary: () =>
        json(
          itineraryBody(trip(), [plan({ date: "2026-10-13" })], "2026-10-13"),
        ),
    });
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ItineraryScreen tripId={tripId} />
      </QueryClientProvider>,
    );

    await screen.findByText("錦市場で昼食");
    const itineraryCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes("itinerary"),
    );
    expect(itineraryCalls).toHaveLength(1);
    expect(String(itineraryCalls[0][0])).not.toContain("date=");
    expect(
      screen.getByRole("link", { name: /2 日目/ }),
    ).toHaveAttribute("aria-current", "date");
  });

  it("W-17: 期間外の日は「旅行期間外です」と期間の日の選択を出す", async () => {
    const fetchMock = stubApi({
      itinerary: () => json({ code: "PLAN_OUTSIDE_TRIP_PERIOD" }, 422),
      trip: () => json(trip()),
    });
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ItineraryScreen tripId={tripId} date="2026-10-20" />
      </QueryClientProvider>,
    );

    expect(
      await screen.findByText(/旅行期間の外です/),
    ).toBeInTheDocument();
    // 期間編集へ行けるよう TripHeader（旅行名とメニュー）は出す。
    expect(
      screen.getByRole("heading", { name: "沖縄" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /メニュー/ }),
    ).toBeInTheDocument();
    // 別の日に自動で変えず、期間の日は選べる。
    expect(
      screen.getByRole("link", { name: /1 日目/ }),
    ).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.filter(([url]) =>
        String(url).includes("itinerary"),
      ),
    ).toHaveLength(1);
  });

  it("表示のあと再取得が失敗しても内容は残して「更新できていません」", async () => {
    let calls = 0;
    stubApi({
      itinerary: () => {
        calls += 1;
        return calls === 1
          ? json(itineraryBody(trip(), [plan()], "2026-10-13"))
          : json({ code: "INTERNAL_ERROR" }, 500);
      },
    });
    const client = createQueryClient();
    render(
      <QueryClientProvider client={client}>
        <ItineraryScreen tripId={tripId} date="2026-10-13" />
      </QueryClientProvider>,
    );

    await screen.findByText("錦市場で昼食");
    await act(async () => {
      await client.invalidateQueries({
        queryKey: ["itinerary", tripId],
      });
    });

    expect(
      await screen.findByText(/更新できていません/),
    ).toBeInTheDocument();
    expect(screen.getByText("錦市場で昼食")).toBeInTheDocument();
  });
});

describe("PlanDetailScreen (/trips/{id}/plans/{planId}）", () => {
  function renderDetail(
    p = plan(),
    from: string | null = "2026-10-13",
    client = createQueryClient(),
  ) {
    render(
      <QueryClientProvider client={client}>
        <PlanDetailScreen tripId={tripId} planId={p.id} from={from} />
      </QueryClientProvider>,
    );
  }

  it("種類・名前・時刻・日付・記録を出し、編集へのリンクがある", async () => {
    stubApi({
      plan: () =>
        json(
          plan({
            memo: "四条河原町の交差点で待ち合わせ",
            booking: {
              id: eventId,
              tripId,
              planId,
              kind: "booking",
              createdBy: userId,
              createdAt: "2026-10-10T20:14:00.000Z",
              cancellation: null,
            },
          }),
        ),
    });
    renderDetail();

    expect(
      await screen.findByRole("heading", { name: "錦市場で昼食" }),
    ).toBeInTheDocument();
    // 見出しのバッジと記録行の両方に出る。
    expect(screen.getAllByText("予約済み")).toHaveLength(2);
    expect(screen.getByText(/ひなた が /)).toBeInTheDocument();
    expect(
      screen.getByText("四条河原町の交差点で待ち合わせ"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "編集" }),
    ).toHaveAttribute("href", `/trips/${tripId}/plans/${planId}/edit`);
    // 戻りは見ていた日のしおり。
    expect(
      screen.getByRole("link", { name: /しおり/ }),
    ).toHaveAttribute(
      "href",
      `/trips/${tripId}/itinerary?date=2026-10-13`,
    );
  });

  it("予定の 404 は「この項目を開けません」としおりへの導線", async () => {
    stubApi({ plan: () => json({ code: "PLAN_NOT_FOUND" }, 404) });
    renderDetail();

    expect(
      await screen.findByText("この項目を開けません"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "しおりに戻る" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "旅行一覧へ" }),
    ).toBeInTheDocument();
  });

  it("W-20: 同じ日は移動を保存できず、別の日は move に送る", async () => {
    const fetchMock = stubApi({
      plan: () => json(plan({ date: "2026-10-13", version: "3" })),
      trip: () => json(trip()),
      move: () => json(plan({ date: "2026-10-14", version: "4" })),
    });
    const client = createQueryClient();
    client.setQueryData(
      ["itinerary", tripId, "2026-10-13"],
      itineraryBody(trip(), [plan()], "2026-10-13"),
    );
    client.setQueryData(
      ["itinerary", tripId, "2026-10-14"],
      itineraryBody(trip(), [], "2026-10-14"),
    );
    client.setQueryData(
      ["plan", tripId, planId],
      plan({ date: "2026-10-13", version: "3" }),
    );
    renderDetail(plan(), "2026-10-13", client);

    await screen.findByRole("heading", { name: "錦市場で昼食" });
    await userEvent.click(
      screen.getByRole("button", { name: /日の移動/ }),
    );

    expect(
      await screen.findByRole("heading", { name: "日の移動" }),
    ).toBeInTheDocument();
    const submit = screen.getByRole("button", {
      name: "この日に移動する",
    });
    // 同じ日（10/13）では押せない。
    expect(submit).toBeDisabled();

    await userEvent.click(
      screen.getByRole("radio", { name: "10/14 水" }),
    );
    expect(submit).toBeEnabled();
    await userEvent.click(submit);

    expect(await screen.findByText("移動しました")).toBeInTheDocument();
    const [url, init] = writeCalls(fetchMock)[0];
    expect(url).toBe(`/api/trips/${tripId}/plans/${planId}/move`);
    expect(JSON.parse(String(init?.body))).toEqual({
      date: "2026-10-14",
    });
    expect(new Headers(init?.headers).get("if-match")).toBe('"3"');
    expect(
      new Headers(init?.headers).get("idempotency-key"),
    ).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    // しおり（旧日・新日とも）と予定詳細を再取得する。
    expect(
      client.getQueryState(["itinerary", tripId, "2026-10-13"])
        ?.isInvalidated,
    ).toBe(true);
    expect(
      client.getQueryState(["itinerary", tripId, "2026-10-14"])
        ?.isInvalidated,
    ).toBe(true);
    // 表示中の予定詳細は無効化されて再取得される（初回 + 再取得で 2 回）。
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(
          ([url, init]) =>
            String(url) === `/api/trips/${tripId}/plans/${planId}` &&
            (init?.method ?? "GET") === "GET",
        ).length,
      ).toBeGreaterThanOrEqual(2),
    );
  });

  it("W-21: 取りやめは名前・日付・記録が残ることを確認してから送る", async () => {
    const fetchMock = stubApi({
      plan: () => json(plan({ version: "2" })),
      cancel: () =>
        json(
          plan({
            cancelledAt: "2026-10-13T18:00:00.000Z",
            cancelledBy: userId,
            version: "3",
          }),
        ),
    });
    renderDetail();

    await screen.findByRole("heading", { name: "錦市場で昼食" });
    await userEvent.click(
      screen.getByRole("button", { name: "取りやめにする" }),
    );

    expect(
      await screen.findByRole("heading", {
        name: "予定を取りやめにしますか？",
      }),
    ).toBeInTheDocument();
    const dialog = document.querySelector("dialog");
    expect(dialog).not.toBeNull();
    const dialogEl = within(dialog as HTMLElement);
    expect(
      dialogEl.getByText(/達成・予約・支払いの記録は残ります/),
    ).toBeInTheDocument();
    expect(dialogEl.getByText(/錦市場で昼食/)).toBeInTheDocument();
    expect(dialogEl.getByText(/10\/13 火/)).toBeInTheDocument();
    const confirm = dialogEl.getByRole("button", {
      name: "取りやめにする",
    });
    await userEvent.click(confirm);

    expect(
      await screen.findByText("取りやめにしました"),
    ).toBeInTheDocument();
    const [url, init] = writeCalls(fetchMock)[0];
    expect(url).toBe(`/api/trips/${tripId}/plans/${planId}/cancel`);
    expect(new Headers(init?.headers).get("if-match")).toBe('"2"');
  });
});

describe("PlanFormScreen（追加 /trips/{id}/plans/new）", () => {
  it("W-18: 時刻未定（time:null）で送り、追加しましたとしおりの再取得", async () => {
    const fetchMock = stubApi({
      trip: () => json(trip()),
      create: () => json(plan({ id: planId }), 201),
    });
    const client = createQueryClient();
    client.setQueryData(
      ["itinerary", tripId, "2026-10-13"],
      itineraryBody(trip(), [], "2026-10-13"),
    );
    render(
      <QueryClientProvider client={client}>
        <PlanFormScreen
          mode="new"
          tripId={tripId}
          date="2026-10-13"
        />
      </QueryClientProvider>,
    );

    expect(
      await screen.findByRole("heading", { name: "予定を追加" }),
    ).toBeInTheDocument();
    await userEvent.type(
      screen.getByLabelText("名前"),
      "国際通りで買い物",
    );
    await userEvent.click(
      screen.getByRole("radio", { name: "買い物" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "保存する" }),
    );

    await waitFor(() =>
      expect(replaceMock).toHaveBeenCalledWith(
        `/trips/${tripId}/itinerary?date=2026-10-13`,
      ),
    );
    // 時刻未定（既定）は time: null で送る。
    const [url, init] = writeCalls(fetchMock)[0];
    expect(url).toBe(`/api/trips/${tripId}/plans`);
    expect(JSON.parse(String(init?.body))).toEqual({
      name: "国際通りで買い物",
      kind: "shopping",
      date: "2026-10-13",
      time: null,
      memo: null,
    });
    expect(
      new Headers(init?.headers).get("idempotency-key"),
    ).not.toBeNull();
    // 追加しましたの表示（しおり側で出す pending toast）としおりの無効化。
    expect(takePendingToast()).toBe("追加しました");
    expect(
      client.getQueryState(["itinerary", tripId, "2026-10-13"])
        ?.isInvalidated,
    ).toBe(true);
  });

  it("種類が未選択では送らず、欄のエラーとフォーカスを出す", async () => {
    const fetchMock = stubApi({ trip: () => json(trip()) });
    render(
      <QueryClientProvider client={createQueryClient()}>
        <PlanFormScreen mode="new" tripId={tripId} date="2026-10-13" />
      </QueryClientProvider>,
    );

    await screen.findByRole("heading", { name: "予定を追加" });
    await userEvent.type(screen.getByLabelText("名前"), "国際通り");
    await userEvent.click(
      screen.getByRole("button", { name: "保存する" }),
    );

    expect(
      await screen.findByText("種類を選んでください"),
    ).toBeInTheDocument();
    expect(writeCalls(fetchMock)).toHaveLength(0);
    // 種類の欄（Segmented の fieldset）にフォーカスする。
    expect(
      document.activeElement instanceof HTMLElement &&
        document.activeElement.classList.contains("segmented"),
    ).toBe(true);
  });

  it("必須の名前が空なら欄のエラーにして送らない", async () => {
    const fetchMock = stubApi({ trip: () => json(trip()) });
    render(
      <QueryClientProvider client={createQueryClient()}>
        <PlanFormScreen mode="new" tripId={tripId} date="2026-10-13" />
      </QueryClientProvider>,
    );

    await screen.findByRole("heading", { name: "予定を追加" });
    await userEvent.click(
      screen.getByRole("button", { name: "保存する" }),
    );

    expect(
      await screen.findByText("予定名を入力してください"),
    ).toBeInTheDocument();
    expect(writeCalls(fetchMock)).toHaveLength(0);
  });
});

describe("PlanFormScreen（編集 /trips/{id}/plans/{planId}/edit）", () => {
  it("変更のあった項目だけを PATCH で送る", async () => {
    const fetchMock = stubApi({
      plan: () =>
        json(plan({ name: "錦市場で昼食", memo: "現地集合" })),
      patch: () => json(plan({ name: "錦市場で昼食と買い物", version: "2" })),
    });
    render(
      <QueryClientProvider client={createQueryClient()}>
        <PlanFormScreen mode="edit" tripId={tripId} planId={planId} />
      </QueryClientProvider>,
    );

    const nameInput = await screen.findByLabelText("名前");
    await waitFor(() => expect(nameInput).toHaveValue("錦市場で昼食"));
    // 日付の欄は編集には無い（日の移動で変える）。
    expect(
      screen.queryByText("日付"),
    ).not.toBeInTheDocument();

    fireEvent.change(nameInput, {
      target: { value: "錦市場で昼食と買い物" },
    });
    await userEvent.click(
      screen.getByRole("button", { name: "保存する" }),
    );

    await waitFor(() =>
      expect(replaceMock).toHaveBeenCalledWith(
        `/trips/${tripId}/plans/${planId}`,
      ),
    );
    const [url, init] = writeCalls(fetchMock)[0];
    expect(init?.method).toBe("PATCH");
    expect(url).toBe(`/api/trips/${tripId}/plans/${planId}`);
    // 変えていない項目は送らない。
    expect(JSON.parse(String(init?.body))).toEqual({
      name: "錦市場で昼食と買い物",
    });
    expect(new Headers(init?.headers).get("if-match")).toBe('"1"');
  });

  it("何も変えずに保存すると送らずに閉じる", async () => {
    const fetchMock = stubApi({ plan: () => json(plan()) });
    render(
      <QueryClientProvider client={createQueryClient()}>
        <PlanFormScreen mode="edit" tripId={tripId} planId={planId} />
      </QueryClientProvider>,
    );

    const nameInput = await screen.findByLabelText("名前");
    await waitFor(() => expect(nameInput).toHaveValue("錦市場で昼食"));
    await userEvent.click(
      screen.getByRole("button", { name: "保存する" }),
    );

    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith(
        `/trips/${tripId}/plans/${planId}`,
      ),
    );
    expect(writeCalls(fetchMock)).toHaveLength(0);
  });

  it("競合で「最新の内容で入力し直す」あと開いたときの値に戻して保存すると差分を送る", async () => {
    let planCalls = 0;
    let patchCalls = 0;
    const fetchMock = stubApi({
      plan: () => {
        planCalls += 1;
        // conflict で取り直した最新は相手が変えた内容。
        return json(
          planCalls === 1
            ? plan({ name: "錦市場で昼食", version: "1" })
            : plan({ name: "相手が変えた名前", version: "5" }),
        );
      },
      patch: () => {
        patchCalls += 1;
        return patchCalls === 1
          ? json({ code: "VERSION_CONFLICT" }, 409)
          : json(plan({ name: "錦市場で昼食", version: "6" }));
      },
    });
    render(
      <QueryClientProvider client={createQueryClient()}>
        <PlanFormScreen mode="edit" tripId={tripId} planId={planId} />
      </QueryClientProvider>,
    );

    const nameInput = await screen.findByLabelText("名前");
    await waitFor(() => expect(nameInput).toHaveValue("錦市場で昼食"));
    fireEvent.change(nameInput, { target: { value: "あなたの名前" } });
    await userEvent.click(
      screen.getByRole("button", { name: "保存する" }),
    );

    expect(
      await screen.findByText("相手が先に変更しました"),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "最新の内容で入力し直す" }),
    );

    // 欄は最新に置き換わる。ここで開いたときの値に戻して保存すると、
    // 基準（最新）との差分として名前を送る。
    await waitFor(() =>
      expect(screen.getByLabelText("名前")).toHaveValue(
        "相手が変えた名前",
      ),
    );
    fireEvent.change(screen.getByLabelText("名前"), {
      target: { value: "錦市場で昼食" },
    });
    await userEvent.click(
      screen.getByRole("button", { name: "保存する" }),
    );

    await waitFor(() =>
      expect(replaceMock).toHaveBeenCalledWith(
        `/trips/${tripId}/plans/${planId}`,
      ),
    );
    const writes = writeCalls(fetchMock);
    expect(writes).toHaveLength(2);
    expect(JSON.parse(String(writes[1][1]?.body))).toEqual({
      name: "錦市場で昼食",
    });
    expect(new Headers(writes[1][1]?.headers).get("if-match")).toBe('"5"');
  });

  it("W-19: 記録がある予定は種類を固定して理由を出す", async () => {
    stubApi({
      plan: () =>
        json(
          plan({
            canChangeKind: false,
            kindChangeReason: "record_history_exists",
            booking: {
              id: eventId,
              tripId,
              planId,
              kind: "booking",
              createdBy: userId,
              createdAt: "2026-10-10T20:14:00.000Z",
              cancellation: null,
            },
          }),
        ),
    });
    render(
      <QueryClientProvider client={createQueryClient()}>
        <PlanFormScreen mode="edit" tripId={tripId} planId={planId} />
      </QueryClientProvider>,
    );

    await screen.findByLabelText("名前");
    expect(
      await screen.findByText(
        "達成・予約の記録があるため、種類は変更できません",
      ),
    ).toBeInTheDocument();
    for (const label of ["場所", "食べ処", "買い物", "宿", "移動"]) {
      expect(
        screen.getByRole("radio", { name: label }),
      ).toBeDisabled();
    }
  });
});

describe("読み込み失敗と拒否の出し分け（C-1 / C-2 / C-4）", () => {
  it("編集の初回取得が失敗したら読み込みをやめて取得失敗を出す", async () => {
    stubApi({
      plan: () => json({ code: "INTERNAL_ERROR" }, 500),
    });
    render(
      <QueryClientProvider client={createQueryClient()}>
        <PlanFormScreen mode="edit" tripId={tripId} planId={planId} />
      </QueryClientProvider>,
    );

    expect(
      await screen.findByText("取得できませんでした"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "再試行" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("読み込み中")).not.toBeInTheDocument();
  });

  it("日の移動で旅行期間の取得が失敗したらシート内で再試行できる", async () => {
    const fetchMock = stubApi({
      plan: () => json(plan()),
      trip: () => json({ code: "INTERNAL_ERROR" }, 500),
    });
    render(
      <QueryClientProvider client={createQueryClient()}>
        <PlanDetailScreen tripId={tripId} planId={planId} from="2026-10-13" />
      </QueryClientProvider>,
    );

    await screen.findByRole("heading", { name: "錦市場で昼食" });
    await userEvent.click(
      screen.getByRole("button", { name: /日の移動/ }),
    );

    expect(
      await screen.findByText("旅行の期間を取得できませんでした"),
    ).toBeInTheDocument();
    const tripCalls = () =>
      fetchMock.mock.calls.filter(
        ([url]) => String(url) === `/api/trips/${tripId}`,
      );
    await userEvent.click(
      screen.getByRole("button", { name: "再試行" }),
    );
    await waitFor(() => expect(tripCalls().length).toBeGreaterThan(1));
  });

  it("日の移動で旅行期間の取得が 401 なら C-1、403 なら C-2", async () => {
    for (const [status, text] of [
      [401, "もう一度ログインしてください"],
      [403, "この旅行を開けません"],
    ] as const) {
      cleanup();
      stubApi({
        plan: () => json(plan()),
        trip: () => json({ code: "ERROR" }, status),
      });
      render(
        <QueryClientProvider client={createQueryClient()}>
          <PlanDetailScreen
            tripId={tripId}
            planId={planId}
            from="2026-10-13"
          />
        </QueryClientProvider>,
      );

      await screen.findByRole("heading", { name: "錦市場で昼食" });
      await userEvent.click(
        screen.getByRole("button", { name: /日の移動/ }),
      );

      expect(await screen.findByText(text)).toBeInTheDocument();
      // 401 は業務データを隠す。
      if (status === 401) {
        expect(
          screen.queryByRole("heading", { name: "錦市場で昼食" }),
        ).not.toBeInTheDocument();
      }
    }
  });

  it("しおりの初回取得が 401 / 403 なら C-1 / C-2", async () => {
    for (const [status, text] of [
      [401, "もう一度ログインしてください"],
      [403, "この旅行を開けません"],
    ] as const) {
      cleanup();
      stubApi({
        itinerary: () => json({ code: "ERROR" }, status),
      });
      render(
        <QueryClientProvider client={createQueryClient()}>
          <ItineraryScreen tripId={tripId} date="2026-10-13" />
        </QueryClientProvider>,
      );

      expect(await screen.findByText(text)).toBeInTheDocument();
    }
  });

  it("表示中の再取得が 401 になっても業務データを隠して C-1", async () => {
    let calls = 0;
    stubApi({
      itinerary: () => {
        calls += 1;
        return calls === 1
          ? json(itineraryBody(trip(), [plan()], "2026-10-13"))
          : json({ code: "UNAUTHENTICATED" }, 401);
      },
    });
    const client = createQueryClient();
    render(
      <QueryClientProvider client={client}>
        <ItineraryScreen tripId={tripId} date="2026-10-13" />
      </QueryClientProvider>,
    );

    await screen.findByText("錦市場で昼食");
    await act(async () => {
      await client.invalidateQueries({
        queryKey: ["itinerary", tripId],
      });
    });

    expect(
      await screen.findByText("もう一度ログインしてください"),
    ).toBeInTheDocument();
    expect(screen.queryByText("錦市場で昼食")).not.toBeInTheDocument();
  });

  it("追加フォームの旅行取得が 401 / 403 なら C-1 / C-2", async () => {
    for (const [status, text] of [
      [401, "もう一度ログインしてください"],
      [403, "この旅行を開けません"],
    ] as const) {
      cleanup();
      stubApi({ trip: () => json({ code: "ERROR" }, status) });
      render(
        <QueryClientProvider client={createQueryClient()}>
          <PlanFormScreen mode="new" tripId={tripId} date="2026-10-13" />
        </QueryClientProvider>,
      );

      expect(await screen.findByText(text)).toBeInTheDocument();
    }
  });

  it("編集フォームの予定取得が 401 / 403 / 404 なら C-1 / C-2", async () => {
    for (const [status, text] of [
      [401, "もう一度ログインしてください"],
      [403, "この旅行を開けません"],
      [404, "この項目を開けません"],
    ] as const) {
      cleanup();
      stubApi({ plan: () => json({ code: "ERROR" }, status) });
      render(
        <QueryClientProvider client={createQueryClient()}>
          <PlanFormScreen mode="edit" tripId={tripId} planId={planId} />
        </QueryClientProvider>,
      );

      expect(await screen.findByText(text)).toBeInTheDocument();
    }
  });

  it("追加の保存が 403 なら C-2「この旅行を開けません」", async () => {
    stubApi({
      trip: () => json(trip()),
      create: () => json({ code: "ERROR" }, 403),
    });
    render(
      <QueryClientProvider client={createQueryClient()}>
        <PlanFormScreen mode="new" tripId={tripId} date="2026-10-13" />
      </QueryClientProvider>,
    );

    await screen.findByRole("heading", { name: "予定を追加" });
    await userEvent.type(screen.getByLabelText("名前"), "国際通り");
    await userEvent.click(
      screen.getByRole("radio", { name: "買い物" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "保存する" }),
    );

    expect(
      await screen.findByText("この旅行を開けません"),
    ).toBeInTheDocument();
  });

  it("編集の保存が 404 なら C-2「この項目を開けません」", async () => {
    stubApi({
      plan: () => json(plan()),
      patch: () => json({ code: "ERROR" }, 404),
    });
    render(
      <QueryClientProvider client={createQueryClient()}>
        <PlanFormScreen mode="edit" tripId={tripId} planId={planId} />
      </QueryClientProvider>,
    );

    const nameInput = await screen.findByLabelText("名前");
    await waitFor(() => expect(nameInput).toHaveValue("錦市場で昼食"));
    fireEvent.change(nameInput, { target: { value: "別の名前" } });
    await userEvent.click(
      screen.getByRole("button", { name: "保存する" }),
    );

    expect(
      await screen.findByText("この項目を開けません"),
    ).toBeInTheDocument();
  });

  it("取りやめの保存が 404 なら C-2「この項目を開けません」", async () => {
    stubApi({
      plan: () => json(plan({ version: "2" })),
      cancel: () => json({ code: "ERROR" }, 404),
    });
    render(
      <QueryClientProvider client={createQueryClient()}>
        <PlanDetailScreen tripId={tripId} planId={planId} from="2026-10-13" />
      </QueryClientProvider>,
    );

    await screen.findByRole("heading", { name: "錦市場で昼食" });
    await userEvent.click(
      screen.getByRole("button", { name: "取りやめにする" }),
    );
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "取りやめにする" }),
    );

    expect(
      await screen.findByText("この項目を開けません"),
    ).toBeInTheDocument();
  });

  it("保存が 401 なら C-1、結果不明のあとの確認なら確認できていない旨を出す", async () => {
    // 直接の 401。
    stubApi({
      trip: () => json(trip()),
      create: () => json({ code: "UNAUTHENTICATED" }, 401),
    });
    render(
      <QueryClientProvider client={createQueryClient()}>
        <PlanFormScreen mode="new" tripId={tripId} date="2026-10-13" />
      </QueryClientProvider>,
    );
    await screen.findByRole("heading", { name: "予定を追加" });
    await userEvent.type(screen.getByLabelText("名前"), "国際通り");
    await userEvent.click(
      screen.getByRole("radio", { name: "買い物" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "保存する" }),
    );
    expect(
      await screen.findByText("もう一度ログインしてください"),
    ).toBeInTheDocument();

    // network 失敗（結果不明）→ 同じ内容で確認 → 401 は「確認できていません」。
    cleanup();
    let calls = 0;
    stubApi({
      trip: () => json(trip()),
      create: () => {
        calls += 1;
        return calls === 1
          ? Promise.reject(new TypeError("network"))
          : json({ code: "UNAUTHENTICATED" }, 401);
      },
    });
    render(
      <QueryClientProvider client={createQueryClient()}>
        <PlanFormScreen mode="new" tripId={tripId} date="2026-10-13" />
      </QueryClientProvider>,
    );
    await screen.findByRole("heading", { name: "予定を追加" });
    await userEvent.type(screen.getByLabelText("名前"), "国際通り");
    await userEvent.click(
      screen.getByRole("radio", { name: "買い物" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "保存する" }),
    );
    expect(
      await screen.findByText("保存されたか確認できません"),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "同じ内容で確認する" }),
    );
    expect(
      await screen.findByText(/保存されたか確認できていません/),
    ).toBeInTheDocument();
  });

  it("編集で 422 のあと欄を直すと新しいキーで送り直せる", async () => {
    let patchCalls = 0;
    const fetchMock = stubApi({
      plan: () => json(plan({ name: "錦市場で昼食", version: "3" })),
      patch: () => {
        patchCalls += 1;
        return patchCalls === 1
          ? json({ code: "VALIDATION_FAILED" }, 422)
          : json(plan({ name: "直した名前", version: "4" }));
      },
    });
    render(
      <QueryClientProvider client={createQueryClient()}>
        <PlanFormScreen mode="edit" tripId={tripId} planId={planId} />
      </QueryClientProvider>,
    );

    const nameInput = await screen.findByLabelText("名前");
    await waitFor(() => expect(nameInput).toHaveValue("錦市場で昼食"));
    fireEvent.change(nameInput, { target: { value: "悪い名前" } });
    await userEvent.click(
      screen.getByRole("button", { name: "保存する" }),
    );

    expect(
      await screen.findByText("入力内容を確認してください"),
    ).toBeInTheDocument();
    // 欄を直したら保存できる（送り直しは新しい idempotency-key）。
    fireEvent.change(nameInput, { target: { value: "直した名前" } });
    const submit = screen.getByRole("button", { name: "保存する" });
    expect(submit).toBeEnabled();
    await userEvent.click(submit);

    await waitFor(() =>
      expect(replaceMock).toHaveBeenCalledWith(
        `/trips/${tripId}/plans/${planId}`,
      ),
    );
    const writes = writeCalls(fetchMock);
    expect(writes).toHaveLength(2);
    const key1 = new Headers(writes[0][1]?.headers).get("idempotency-key");
    const key2 = new Headers(writes[1][1]?.headers).get("idempotency-key");
    expect(key1).not.toBeNull();
    expect(key2).not.toBeNull();
    expect(key2).not.toBe(key1);
    // サーバーは拒否した要求で予定を変えないので同じ ETag でよい。
    expect(new Headers(writes[1][1]?.headers).get("if-match")).toBe('"3"');
  });

  it("編集で 428 のあとは取り直すまで送れず、取り直すと新しい ETag で送れる", async () => {
    let planCalls = 0;
    let patchCalls = 0;
    const fetchMock = stubApi({
      plan: () => {
        planCalls += 1;
        return json(
          planCalls === 1
            ? plan({ version: "3" })
            : plan({ version: "5" }),
        );
      },
      patch: () => {
        patchCalls += 1;
        return patchCalls === 1
          ? json({ code: "IF_MATCH_REQUIRED" }, 428)
          : json(plan({ name: "直した名前", version: "6" }));
      },
    });
    render(
      <QueryClientProvider client={createQueryClient()}>
        <PlanFormScreen mode="edit" tripId={tripId} planId={planId} />
      </QueryClientProvider>,
    );

    const nameInput = await screen.findByLabelText("名前");
    await waitFor(() => expect(nameInput).toHaveValue("錦市場で昼食"));
    fireEvent.change(nameInput, { target: { value: "直した名前" } });
    await userEvent.click(
      screen.getByRole("button", { name: "保存する" }),
    );

    expect(
      await screen.findByText("画面を更新してからやり直してください"),
    ).toBeInTheDocument();
    // 欄を変えても送り直せない（ETag が古い）。
    fireEvent.change(nameInput, { target: { value: "もう一度直す" } });
    expect(
      screen.getByRole("button", { name: "保存する" }),
    ).toBeDisabled();

    // 最新を取り直すと予定を再取得し、新しい ETag で送れる。
    await userEvent.click(
      screen.getByRole("button", { name: "最新を取り直す" }),
    );
    await waitFor(() => expect(planCalls).toBeGreaterThanOrEqual(2));
    const submit = await screen.findByRole("button", { name: "保存する" });
    await waitFor(() => expect(submit).toBeEnabled());
    await userEvent.click(submit);

    await waitFor(() =>
      expect(replaceMock).toHaveBeenCalledWith(
        `/trips/${tripId}/plans/${planId}`,
      ),
    );
    const writes = writeCalls(fetchMock);
    expect(writes).toHaveLength(2);
    expect(new Headers(writes[1][1]?.headers).get("if-match")).toBe('"5"');
  });

  it("移動で期間外に拒否されたあと別の日を選ぶと送り直せる", async () => {
    let moveCalls = 0;
    const fetchMock = stubApi({
      plan: () => json(plan({ date: "2026-10-13", version: "3" })),
      trip: () => json(trip()),
      move: () => {
        moveCalls += 1;
        return moveCalls === 1
          ? json({ code: "PLAN_OUTSIDE_TRIP_PERIOD" }, 422)
          : json(plan({ date: "2026-10-14", version: "4" }));
      },
    });
    render(
      <QueryClientProvider client={createQueryClient()}>
        <PlanDetailScreen tripId={tripId} planId={planId} from="2026-10-13" />
      </QueryClientProvider>,
    );

    await screen.findByRole("heading", { name: "錦市場で昼食" });
    await userEvent.click(
      screen.getByRole("button", { name: /日の移動/ }),
    );
    await screen.findByRole("heading", { name: "日の移動" });
    await userEvent.click(
      screen.getByRole("radio", { name: "10/14 水" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "この日に移動する" }),
    );

    // 期間外は日付欄のエラーとして出る。
    expect(
      await screen.findByText(/旅行期間の外です/),
    ).toBeInTheDocument();
    const submit = screen.getByRole("button", {
      name: "この日に移動する",
    });
    // 選んだ日が拒否と同じなら押せない（sameDay は今の日ではなく選択比較
    // なので、別の日に選び直すと編集に戻る）。
    await userEvent.click(
      screen.getByRole("radio", { name: "10/12 月" }),
    );
    await waitFor(() => expect(submit).toBeEnabled());
    await userEvent.click(submit);

    expect(await screen.findByText("移動しました")).toBeInTheDocument();
    const moves = fetchMock.mock.calls.filter(
      ([url]) => String(url) === `/api/trips/${tripId}/plans/${planId}/move`,
    );
    expect(moves).toHaveLength(2);
    expect(
      new Headers(moves[1][1]?.headers).get("idempotency-key"),
    ).not.toBe(
      new Headers(moves[0][1]?.headers).get("idempotency-key"),
    );
  });
});
