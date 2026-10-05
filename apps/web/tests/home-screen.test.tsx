import "fake-indexeddb/auto";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Participant, Trip } from "@tomotabi/contracts";
import type {
  Home,
  Schedule,
  TimelineItem,
} from "@/features/trips";
import { createQueryClient } from "@/shared/api/query-client";

const { replaceMock, pushMock, signOutMock } = vi.hoisted(() => ({
  replaceMock: vi.fn(),
  pushMock: vi.fn(),
  signOutMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, push: pushMock }),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

vi.mock("@/shared/auth/auth-client", () => ({
  authClient: { signOut: signOutMock },
}));

import HomePage from "@/app/trips/[tripId]/home/page";
import { HomeScreen } from "@/screens/home/home-screen";

const userId = "550e8400-e29b-41d4-a716-446655440000";
const partnerId = "a1b2c3d4-e5f6-47a8-b9c0-d1e2f3a4b5c6";
const tripId = "8a6e0804-2bd0-4672-b79d-d97027f9071a";
const planId = "11111111-2222-4333-8444-555555555555";
const hiddenPlanId = "66666666-7777-4888-8999-000000000000";
const paymentId = "99999999-8888-4777-8666-555555555555";
const selectedKey = `tomotabi:selected-trip:${userId}`;

const meBody = {
  user: { id: userId, displayName: "ひなた" },
  sessionExpiresAt: "2026-10-03T07:43:00.000Z",
};

const participants: Participant[] = [
  { userId: partnerId, slot: 0, displayName: "あおい" },
  { userId, slot: 1, displayName: "ひなた" },
];

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

type HomePlan = Schedule["items"][number];

function plan(overrides: Partial<HomePlan> = {}): HomePlan {
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

function home(overrides: Partial<Home> = {}): Home {
  return {
    trip: trip(),
    context: {
      today: "2026-10-07",
      mode: "before",
      targetDate: "2026-10-12",
      dayNumber: null,
      daysUntilStart: 5,
      suggestedAction: null,
    },
    schedule: {
      status: "ok",
      data: {
        date: "2026-10-12",
        items: [],
        totalCount: 0,
        achievedCount: 0,
      },
    },
    balance: {
      status: "ok",
      data: {
        transfer: {
          signedTotalYen: "0",
          amountYen: "0",
          fromUserId: null,
          toUserId: null,
          requiresTransfer: false,
        },
        targetCount: 0,
      },
    },
    recentRecords: { status: "ok", data: [] },
    fetchedAt: "2026-10-07T12:00:00.000Z",
    ...overrides,
  };
}

function record(overrides: Partial<TimelineItem> = {}): TimelineItem {
  return {
    id: paymentId,
    kind: "payment",
    createdAt: "2026-10-13T00:20:00.000Z",
    actorId: partnerId,
    planId: null,
    targetId: paymentId,
    detail: {
      id: paymentId,
      tripId,
      planId: null,
      label: "昼食代",
      amountYen: "1285",
      payerUserId: partnerId,
      allocations: [
        { userId: partnerId, percent: 50, burdenYen: "643" },
        { userId, percent: 50, burdenYen: "642" },
      ],
      createdBy: partnerId,
      createdAt: "2026-10-13T00:20:00.000Z",
      cancellation: null,
    },
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

type Handler = (init?: RequestInit) => Response | Promise<Response>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function notFound(): Response {
  return json({ code: "NOT_FOUND" }, 404);
}

/**
 * /api/me と /api/trips/* をURL・メソッドで振り分けるfake。
 * ハンドラは呼ばれるたびに評価する（成功→失敗の切り替えが書ける）。
 */
function stubApi(handlers: {
  me?: Handler;
  home?: Handler;
  balance?: Handler;
  plan?: Handler;
  payment?: Handler;
  trip?: Handler;
  start?: Handler;
  finish?: Handler;
}): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = urlOf(input);
    const method = init?.method ?? "GET";
    if (url === "/api/me") {
      return Promise.resolve(
        handlers.me !== undefined ? handlers.me(init) : json(meBody),
      );
    }
    if (url === `/api/trips/${tripId}/home` && method === "GET") {
      return Promise.resolve(
        handlers.home !== undefined ? handlers.home(init) : json(home()),
      );
    }
    if (url === `/api/trips/${tripId}/balance` && method === "GET") {
      return Promise.resolve(
        handlers.balance !== undefined
          ? handlers.balance(init)
          : json({
              tripId,
              participants,
              transfer: {
                signedTotalYen: "0",
                amountYen: "0",
                fromUserId: null,
                toUserId: null,
                requiresTransfer: false,
              },
              targetCount: 0,
              items: [],
              fetchedAt: "2026-10-07T12:00:00.000Z",
            }),
      );
    }
    const planMatch = url.match(
      new RegExp(`^/api/trips/${tripId}/plans/([0-9a-f-]+)$`),
    );
    if (planMatch !== null && method === "GET") {
      return Promise.resolve(
        handlers.plan !== undefined
          ? handlers.plan(init)
          : json(
              plan({
                id: planMatch[1],
                name: "先斗町で夕食",
              }),
            ),
      );
    }
    const paymentMatch = url.match(
      new RegExp(`^/api/trips/${tripId}/payments/([0-9a-f-]+)$`),
    );
    if (paymentMatch !== null && method === "GET") {
      return Promise.resolve(
        handlers.payment !== undefined
          ? handlers.payment(init)
          : json({
              id: paymentMatch[1],
              tripId,
              planId: null,
              label: "昼食代",
              amountYen: "1285",
              payerUserId: partnerId,
              allocations: [
                { userId: partnerId, percent: 50, burdenYen: "643" },
                { userId, percent: 50, burdenYen: "642" },
              ],
              createdBy: partnerId,
              createdAt: "2026-10-13T00:20:00.000Z",
              cancellation: null,
            }),
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
      <HomeScreen tripId={id} />
    </QueryClientProvider>,
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

afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  window.localStorage.clear();
  await resetDb();
});

describe("HomeScreen (/trips/{id}/home)", () => {
  it("RW-12: 出発前は初日の予定と出発までの日数を出し、前回の旅行に保存する", async () => {
    stubApi({
      home: () =>
        json(
          home({
            schedule: {
              status: "ok",
              data: {
                date: "2026-10-12",
                items: [plan({ name: "首里城", kind: "place", time: "10:00", date: "2026-10-12" })],
                totalCount: 1,
                achievedCount: 0,
              },
            },
            balance: {
              status: "ok",
              data: {
                transfer: {
                  signedTotalYen: "1285",
                  amountYen: "1285",
                  fromUserId: partnerId,
                  toUserId: userId,
                  requiresTransfer: true,
                },
                targetCount: 2,
              },
            },
            recentRecords: { status: "ok", data: [record()] },
          }),
        ),
    });
    renderScreen();

    // ヘッダー: 出発までの日数と初日、旅行名、切り替え（/trips）。
    expect(
      await screen.findByRole("heading", { name: "沖縄" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/出発まで 5 日/)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /切り替え/ }),
    ).toHaveAttribute("href", "/trips");
    expect(
      screen.getByRole("button", { name: "旅行のメニュー" }),
    ).toBeInTheDocument();

    // 予定の欄: 「初日の予定」と件数、行は予定の詳細へ（from=home）。
    expect(
      screen.getByRole("heading", { name: /初日の予定/ }),
    ).toBeInTheDocument();
    expect(screen.getByText(/1 件/)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /首里城/ }),
    ).toHaveAttribute(
      "href",
      `/trips/${tripId}/plans/${planId}?from=home`,
    );

    // 精算の欄: 誰から誰へいくら・対象の件数・精算へ。
    const settle = screen.getByRole("link", { name: "精算へ" })
      .closest("section")!;
    // 参加者の名前は残額の取得を待ってから出る。
    await waitFor(() =>
      expect(settle).toHaveTextContent(/あおい から ひなた へ/),
    );
    expect(settle).toHaveTextContent("1,285");
    expect(settle).toHaveTextContent("対象 2 件");
    expect(
      screen.getByRole("link", { name: "精算へ" }),
    ).toHaveAttribute("href", `/trips/${tripId}/settlement`);

    // 最近の記録: 支払いの行（用途・時刻・誰・折半・金額）と記録一覧へ。
    expect(screen.getByText("昼食代")).toBeInTheDocument();
    expect(screen.getByText(/あおい が支払い · 折半/)).toBeInTheDocument();
    expect(screen.getByText("1,285 円")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "記録一覧へ" }),
    ).toHaveAttribute("href", `/trips/${tripId}/records`);

    // 下のタブは「ホーム」が現在地。「支払いを記録」は予定を選ばない（F-49）。
    const nav = screen.getByRole("navigation", { name: "タブ" });
    expect(nav.querySelector('[aria-current="page"]')).toHaveTextContent(
      "ホーム",
    );
    expect(
      screen.getByRole("link", { name: "支払いを記録" }),
    ).toHaveAttribute("href", `/trips/${tripId}/payments/new`);

    await waitFor(() =>
      expect(window.localStorage.getItem(selectedKey)).toBe(tripId),
    );
  });

  it("RW-12: 期間中は今日の予定と「何日目」。未開始なら旅行を開始の案内", async () => {
    stubApi({
      home: () =>
        json(
          home({
            context: {
              today: "2026-10-13",
              mode: "during",
              targetDate: "2026-10-13",
              dayNumber: 2,
              daysUntilStart: null,
              suggestedAction: "start",
            },
            schedule: {
              status: "ok",
              data: {
                date: "2026-10-13",
                items: [plan()],
                totalCount: 1,
                achievedCount: 0,
              },
            },
          }),
        ),
    });
    renderScreen();

    expect(
      await screen.findByRole("heading", { name: "沖縄" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/10\/13 火 · 2 \/ 3 日目/)).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /今日の予定/ }),
    ).toBeInTheDocument();

    // まだ開始していない日は「旅行を開始」への案内（メニューを開く）。
    expect(
      screen.getByText("この旅行はまだ開始していません"),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "旅行を開始する" }),
    );
    expect(
      await screen.findByText("ひなた としてログイン中"),
    ).toBeInTheDocument();
  });

  it("RW-12: 終了後は予定の欄を出さず、精算と記録を上に、しおりへの案内", async () => {
    stubApi({
      home: () =>
        json(
          home({
            trip: trip({
              status: "finished",
              startedAt: "2026-10-12T01:00:00.000Z",
              finishedAt: "2026-10-14T09:00:00.000Z",
              startedBy: userId,
              finishedBy: userId,
            }),
            context: {
              today: "2026-10-20",
              mode: "completed",
              targetDate: null,
              dayNumber: null,
              daysUntilStart: null,
              suggestedAction: null,
            },
            schedule: { status: "ok", data: null },
          }),
        ),
    });
    renderScreen();

    expect(
      await screen.findByRole("heading", { name: "沖縄" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/終了 · 10\/12 月/)).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /の予定/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /しおりへ/ }),
    ).toHaveAttribute("href", `/trips/${tripId}/itinerary`);
    expect(screen.getByText(/精算する対象はありません/)).toBeInTheDocument();
    expect(screen.getByText("記録はまだありません")).toBeInTheDocument();
  });

  it("RW-13: 期間が過ぎた（旅行中）は終了の帯と「旅行を終了する」", async () => {
    stubApi({
      home: () =>
        json(
          home({
            trip: trip({
              status: "traveling",
              startedAt: "2026-10-12T01:00:00.000Z",
              startedBy: userId,
            }),
            context: {
              today: "2026-10-20",
              mode: "after_dates",
              targetDate: null,
              dayNumber: null,
              daysUntilStart: null,
              suggestedAction: "finish",
            },
            schedule: { status: "ok", data: null },
          }),
        ),
    });
    renderScreen();

    expect(
      await screen.findByRole("heading", { name: "沖縄" }),
    ).toBeInTheDocument();
    // 青いお知らせ帯（終了日つき）と案内。
    expect(
      screen.getByText(/旅行の期間が終わりました（10\/14 水 まで）/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/終了したあとも精算・編集はできます/),
    ).toBeInTheDocument();
    // 予定の欄は出さない。しおりへの案内は残す。
    expect(
      screen.queryByRole("heading", { name: /の予定/ }),
    ).not.toBeInTheDocument();

    // 「旅行を終了する」は今ある終了の確認へ。
    await userEvent.click(
      screen.getByRole("button", { name: "旅行を終了する" }),
    );
    expect(
      await screen.findByRole("heading", { name: "旅行を終了しますか？" }),
    ).toBeInTheDocument();
  });

  it("RW-13: 期間が過ぎた（計画中）は開始してから終了する案内", async () => {
    stubApi({
      home: () =>
        json(
          home({
            context: {
              today: "2026-10-20",
              mode: "after_dates",
              targetDate: null,
              dayNumber: null,
              daysUntilStart: null,
              suggestedAction: "start",
            },
            schedule: { status: "ok", data: null },
          }),
        ),
    });
    renderScreen();

    expect(
      await screen.findByRole("heading", { name: "沖縄" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/旅行の期間が終わりました（10\/14 水 まで）/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/旅行を開始してから終了してください/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "旅行を終了する" }),
    ).not.toBeInTheDocument();
    // 「旅行を開始する」はメニューを開く。
    await userEvent.click(
      screen.getByRole("button", { name: "旅行を開始する" }),
    );
    expect(
      await screen.findByText("ひなた としてログイン中"),
    ).toBeInTheDocument();
  });

  it("RW-14: 欄ごとの失敗はその欄だけに出し、ほかの欄は出す", async () => {
    stubApi({
      home: () =>
        json(
          home({
            schedule: { status: "unavailable", code: "TEMPORARILY_UNAVAILABLE" },
            recentRecords: {
              status: "unavailable",
              code: "TEMPORARILY_UNAVAILABLE",
            },
          }),
        ),
    });
    renderScreen();

    expect(
      await screen.findByRole("heading", { name: "沖縄" }),
    ).toBeInTheDocument();
    // 予定の欄と記録の欄はそれぞれ失敗、精算の欄は出る。
    expect(
      screen.getAllByText("取得できませんでした").length,
    ).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/精算する対象はありません/)).toBeInTheDocument();
  });

  it("RW-14: 精算額が取れないときは「精算額を取得できませんでした」で0円にしない", async () => {
    stubApi({
      home: () =>
        json(
          home({
            balance: {
              status: "unavailable",
              code: "TEMPORARILY_UNAVAILABLE",
            },
          }),
        ),
    });
    renderScreen();

    expect(
      await screen.findByText("精算額を取得できませんでした"),
    ).toBeInTheDocument();
    expect(screen.getByText("— — 円")).toBeInTheDocument();
    expect(screen.queryByText("0 円")).not.toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "再試行" }),
    ).toBeInTheDocument();
  });

  it("RW-14: 「達成済み N 件」「ほか N 件」、宿・移動には達成を出さない", async () => {
    const achieved = {
      id: "22222222-3333-4444-8555-666666666666",
      tripId,
      planId,
      kind: "achievement" as const,
      createdBy: partnerId,
      createdAt: "2026-10-13T02:00:00.000Z",
      cancellation: null,
    };
    stubApi({
      home: () =>
        json(
          home({
            schedule: {
              status: "ok",
              data: {
                date: "2026-10-12",
                items: [
                  plan({
                    id: planId,
                    name: "首里城",
                    kind: "place",
                    date: "2026-10-12",
                    achievement: achieved,
                  }),
                  plan({
                    id: "33333333-4444-4555-8666-777777777777",
                    name: "ホテルに泊まる",
                    kind: "lodging",
                    date: "2026-10-12",
                    time: null,
                    achievement: achieved,
                  }),
                  plan({
                    id: "44444444-5555-4666-8777-888888888888",
                    name: "那覇空港へ",
                    kind: "transport",
                    date: "2026-10-12",
                    time: "18:00",
                  }),
                ],
                totalCount: 6,
                achievedCount: 2,
              },
            },
          }),
        ),
    });
    renderScreen();

    await screen.findByRole("heading", { name: "沖縄" });
    // 達成済みの折りたたみと「ほか N 件」（6 - 3行 - 達成2 = 1）。
    expect(
      screen.getByRole("link", { name: /達成済み 2 件/ }),
    ).toHaveAttribute(
      "href",
      `/trips/${tripId}/itinerary?date=2026-10-12`,
    );
    expect(
      screen.getByRole("link", { name: /ほか 1 件/ }),
    ).toBeInTheDocument();
    // 場所には達成を出すが、宿・移動には出さない（F-46）。
    const hotel = screen.getByRole("link", { name: /ホテルに泊まる/ });
    expect(within(hotel).queryByText(/達成/)).not.toBeInTheDocument();
    const airport = screen.getByRole("link", { name: /那覇空港へ/ });
    expect(within(airport).queryByText(/達成/)).not.toBeInTheDocument();
    const castle = screen.getByRole("link", { name: /首里城/ });
    expect(within(castle).getByText("達成")).toBeInTheDocument();
    // すべて見るは期間の日のしおりへ。
    expect(
      screen.getByRole("link", { name: "すべて見る" }),
    ).toHaveAttribute(
      "href",
      `/trips/${tripId}/itinerary?date=2026-10-12`,
    );
  });

  it("予定0件は「この日の予定はまだありません」と予定の追加（data:nullは欄を出さない）", async () => {
    stubApi({});
    renderScreen();

    expect(
      await screen.findByText("この日の予定はまだありません"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /予定を追加/ }),
    ).toHaveAttribute(
      "href",
      `/trips/${tripId}/plans/new?date=2026-10-12`,
    );

    cleanup();
    stubApi({
      home: () =>
        json(
          home({
            schedule: { status: "ok", data: null },
          }),
        ),
    });
    render(
      <QueryClientProvider client={createQueryClient()}>
        <HomeScreen tripId={tripId} />
      </QueryClientProvider>,
    );
    await screen.findByRole("heading", { name: "沖縄" });
    expect(
      screen.queryByRole("heading", { name: /の予定/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("この日の予定はまだありません"),
    ).not.toBeInTheDocument();
  });

  it("精算: 対象0件はリンクを出さず、対象ありで0円は「受け渡しは不要です」", async () => {
    stubApi({});
    renderScreen();

    expect(
      await screen.findByText("現在、精算する対象はありません"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "精算へ" }),
    ).not.toBeInTheDocument();

    cleanup();
    stubApi({
      home: () =>
        json(
          home({
            balance: {
              status: "ok",
              data: {
                transfer: {
                  signedTotalYen: "0",
                  amountYen: "0",
                  fromUserId: null,
                  toUserId: null,
                  requiresTransfer: false,
                },
                targetCount: 3,
              },
            },
          }),
        ),
    });
    render(
      <QueryClientProvider client={createQueryClient()}>
        <HomeScreen tripId={tripId} />
      </QueryClientProvider>,
    );
    expect(
      await screen.findByText("受け渡しは不要です"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("未処理の対象が 3 件あります"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "精算へ" }),
    ).toBeInTheDocument();
  });

  it("記録: 取り消しは「〇〇を取り消し」、取り消し済みの行は取消線と印", async () => {
    stubApi({
      home: () =>
        json(
          home({
            recentRecords: {
              status: "ok",
              data: [
                record({
                  id: paymentId,
                  detail: {
                    id: paymentId,
                    tripId,
                    planId: null,
                    label: null,
                    amountYen: "3200",
                    payerUserId: userId,
                    allocations: [
                      { userId, percent: 50, burdenYen: "1600" },
                      { userId: partnerId, percent: 50, burdenYen: "1600" },
                    ],
                    createdBy: userId,
                    createdAt: "2026-10-13T00:20:00.000Z",
                    cancellation: {
                      targetId: paymentId,
                      cancelledBy: partnerId,
                      createdAt: "2026-10-13T03:00:00.000Z",
                    },
                  },
                }),
                record({
                  id: "77777777-6666-4555-8444-333333333333",
                  kind: "payment_cancellation",
                  createdAt: "2026-10-13T01:00:00.000Z",
                  actorId: partnerId,
                  targetId: "77777777-6666-4555-8444-333333333333",
                  detail: {
                    targetId: "77777777-6666-4555-8444-333333333333",
                    cancelledBy: partnerId,
                    createdAt: "2026-10-13T01:00:00.000Z",
                  },
                }),
                record({
                  id: "88888888-9999-4000-8111-222222222222",
                  kind: "booking_cancellation",
                  createdAt: "2026-10-13T02:00:00.000Z",
                  actorId: userId,
                  planId: hiddenPlanId,
                  targetId: "88888888-9999-4000-8111-222222222222",
                  detail: {
                    targetId: "88888888-9999-4000-8111-222222222222",
                    cancelledBy: userId,
                    createdAt: "2026-10-13T02:00:00.000Z",
                  },
                }),
              ],
            },
          }),
        ),
      plan: (init) => {
        void init;
        return json(plan({ id: hiddenPlanId, name: "先斗町で夕食" }));
      },
    });
    renderScreen();

    await screen.findByRole("heading", { name: "沖縄" });
    // 用途の無い支払いは「支払い」。取り消し済みは取消線の印を出す。
    const records = screen.getByText("最近の記録").closest("section")!;
    const voidedRow = within(records).getByRole("link", {
      name: /^支払い /,
    });
    expect(within(voidedRow).getByText("取り消し済み")).toBeInTheDocument();
    // 支払いの取り消しは元の用途（支払いを個別に引く）。
    expect(
      await screen.findByText("昼食代を取り消し"),
    ).toBeInTheDocument();
    // 予約の取り消しは予定名（予定を個別に引く）。
    expect(
      await screen.findByText("先斗町で夕食を取り消し"),
    ).toBeInTheDocument();
    // 支払いの取り消しの行は支払いの詳細へ。
    expect(
      screen.getByRole("link", { name: /昼食代を取り消し/ }),
    ).toHaveAttribute(
      "href",
      `/trips/${tripId}/payments/77777777-6666-4555-8444-333333333333`,
    );
  });

  it("401は業務データを隠して「もう一度ログインしてください」", async () => {
    stubApi({
      home: () => json({ code: "UNAUTHENTICATED" }, 401),
    });
    renderScreen();

    expect(
      await screen.findByText("もう一度ログインしてください"),
    ).toBeInTheDocument();
    expect(screen.queryByText("沖縄")).not.toBeInTheDocument();
  });

  it.each([403, 404])(
    "取得が %i なら同じ文言「この旅行を開けません」",
    async (status) => {
      stubApi({
        home: () => json({ code: "TRIP_NOT_ACCESSIBLE" }, status),
      });
      renderScreen();

      expect(
        await screen.findByText("この旅行を開けません"),
      ).toBeInTheDocument();
    },
  );

  it("403 なら「前回の旅行」の保存値を消す（B-09）", async () => {
    stubApi({
      home: () => json({ code: "TRIP_NOT_ACCESSIBLE" }, 403),
    });
    window.localStorage.setItem(selectedKey, tripId);
    renderScreen();

    await screen.findByText("この旅行を開けません");
    await waitFor(() =>
      expect(window.localStorage.getItem(selectedKey)).toBeNull(),
    );
  });

  it("503 など一時的な失敗は全体の取得失敗（再試行で取り直す）", async () => {
    let calls = 0;
    stubApi({
      home: () => {
        calls += 1;
        return calls === 1
          ? json({ code: "INTERNAL_ERROR" }, 503)
          : json(home());
      },
    });
    renderScreen();

    expect(
      await screen.findByText("取得できませんでした"),
    ).toBeInTheDocument();
    expect(screen.queryByText("沖縄")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "再試行" }));
    expect(
      await screen.findByRole("heading", { name: "沖縄" }),
    ).toBeInTheDocument();
  });

  it("URL の tripId が UUID でなければ notFound", async () => {
    stubApi({});
    await expect(
      HomePage({ params: Promise.resolve({ tripId: "not-uuid" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
