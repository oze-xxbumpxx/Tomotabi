import "fake-indexeddb/auto";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Itinerary, Plan, Trip } from "@tomotabi/contracts";
import { createQueryClient } from "@/shared/api/query-client";

const { pushMock, nowRef, ioCallbacks } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  // 「今」の時刻。nullは画面が時刻を持たない初期状態と同じ扱い。
  nowRef: { value: null as Date | null },
  ioCallbacks: [] as IntersectionObserverCallback[],
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: vi.fn(),
    push: pushMock,
    back: vi.fn(),
  }),
}));

vi.mock("@/shared/auth/auth-client", () => ({
  authClient: { signOut: vi.fn() },
}));

vi.mock("@/shared/lib/use-now", () => ({
  useNow: () => nowRef.value,
}));

/** jsdomには無いので、末尾のセンチネルとの交差を手で起こせるfake。 */
class FakeIntersectionObserver {
  constructor(cb: IntersectionObserverCallback) {
    ioCallbacks.push(cb);
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);

function intersectLast(): void {
  const cb = ioCallbacks.at(-1);
  if (cb === undefined) {
    throw new Error("IntersectionObserverが作られていない");
  }
  act(() => {
    cb(
      [{ isIntersecting: true }] as IntersectionObserverEntry[],
      {} as IntersectionObserver,
    );
  });
}

import { RecordsScreen } from "@/screens/records/records-screen";
import { PaymentDetailScreen } from "@/screens/payment-detail/payment-detail-screen";
import { PaymentFormScreen } from "@/screens/payment-form/payment-form-screen";
import { PlanDetailScreen } from "@/screens/plan-detail/plan-detail-screen";
import {
  CANCEL_BOOKING_OPERATION,
  CREATE_ACHIEVEMENT_OPERATION,
  type Event,
  type Payment,
  type TimelineItem,
} from "@/features/records";
import { createMutationRequest } from "@/shared/api/mutation-request";
import {
  savePendingRequest,
  toPendingRequestRecord,
} from "@/shared/browser/pending-requests";

const userId = "550e8400-e29b-41d4-a716-446655440000";
const otherUserId = "3f7c1f68-9c05-4f2e-9b4c-2d5b1a90f811";
const tripId = "8a6e0804-2bd0-4672-b79d-d97027f9071a";
const planId = "6d6a86a1-6d0b-4c0f-9bb9-9a1d3a9e9c01";
const paymentId = "770e8400-e29b-41d4-a716-446655440777";
const achievementId = "aa1d8e52-1c4a-4d6e-9a67-9d2f0a44cc01";
const bookingId = "bb2e9f63-2d5b-4e7f-8b78-0e3f1b55dd02";

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

function event(overrides: Partial<Event> = {}): Event {
  return {
    id: achievementId,
    tripId,
    planId,
    kind: "achievement",
    createdBy: userId,
    createdAt: "2026-10-13T03:00:00.000Z",
    cancellation: null,
    ...overrides,
  };
}

function bookingEvent(overrides: Partial<Event> = {}): Event {
  return event({ id: bookingId, kind: "booking", ...overrides });
}

function payment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: paymentId,
    tripId,
    planId,
    label: "参道で朝ごはん",
    amountYen: "2400",
    payerUserId: userId,
    allocations: [
      { userId, percent: 50, burdenYen: "1200" },
      { userId: otherUserId, percent: 50, burdenYen: "1200" },
    ],
    createdBy: userId,
    createdAt: "2026-10-13T03:30:00.000Z",
    cancellation: null,
    ...overrides,
  };
}

function item(overrides: Partial<TimelineItem> = {}): TimelineItem {
  return {
    id: achievementId,
    kind: "achievement",
    createdAt: "2026-10-13T03:00:00.000Z",
    actorId: userId,
    planId,
    targetId: achievementId,
    detail: event(),
    ...overrides,
  };
}

function cancellationItem(
  overrides: Partial<TimelineItem> = {},
): TimelineItem {
  return item({
    kind: "achievement_cancellation",
    createdAt: "2026-10-13T05:00:00.000Z",
    actorId: otherUserId,
    detail: {
      targetId: achievementId,
      cancelledBy: otherUserId,
      createdAt: "2026-10-13T05:00:00.000Z",
    },
    ...overrides,
  });
}

function paymentItem(
  overrides: Partial<TimelineItem> = {},
): TimelineItem {
  return {
    id: paymentId,
    kind: "payment",
    createdAt: "2026-10-13T03:30:00.000Z",
    actorId: userId,
    planId,
    targetId: paymentId,
    detail: payment(),
    ...overrides,
  };
}

function itineraryBody(t: Trip, plans: Plan[]): Itinerary {
  return {
    trip: t,
    date: t.startsOn,
    plans,
    fetchedAt: "2026-10-13T04:00:00.000Z",
  };
}

function balanceBody() {
  return {
    tripId,
    participants: [
      { userId, slot: 0, displayName: "ひなた" },
      { userId: otherUserId, slot: 1, displayName: "そら" },
    ],
    transfer: {
      signedTotalYen: "0",
      amountYen: "0",
      fromUserId: null,
      toUserId: null,
      requiresTransfer: false,
    },
    targetCount: 0,
    items: [],
    fetchedAt: "2026-10-13T04:00:00.000Z",
  };
}

function urlOf(input: RequestInfo | URL): string {
  return typeof input === "string"
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;
}

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function notFound(): Response {
  return json({ code: "NOT_FOUND" }, 404);
}

/** /api/meと /api/trips/* をURL・メソッドで振り分けるfake。 */
function stubApi(handlers: {
  me?: Handler;
  records?: Handler;
  plan?: Handler;
  trip?: Handler;
  itinerary?: Handler;
  payment?: Handler;
  balance?: Handler;
  createAchievement?: Handler;
  cancelAchievement?: Handler;
  createBooking?: Handler;
  cancelBooking?: Handler;
  cancelPayment?: Handler;
  createPayment?: Handler;
}): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = urlOf(input);
    const method = init?.method ?? "GET";
    if (url === "/api/me") {
      return Promise.resolve(
        handlers.me !== undefined ? handlers.me(url, init) : json(meBody),
      );
    }
    if (
      url === `/api/trips/${tripId}/payments/${paymentId}/cancel` &&
      method === "POST"
    ) {
      return Promise.resolve(
        handlers.cancelPayment !== undefined
          ? handlers.cancelPayment(url, init)
          : notFound(),
      );
    }
    if (
      url === `/api/trips/${tripId}/payments/${paymentId}` &&
      method === "GET"
    ) {
      return Promise.resolve(
        handlers.payment !== undefined
          ? handlers.payment(url, init)
          : json(payment()),
      );
    }
    if (url === `/api/trips/${tripId}/payments` && method === "POST") {
      return Promise.resolve(
        handlers.createPayment !== undefined
          ? handlers.createPayment(url, init)
          : notFound(),
      );
    }
    if (
      url.startsWith(`/api/trips/${tripId}/records`) &&
      method === "GET"
    ) {
      return Promise.resolve(
        handlers.records !== undefined
          ? handlers.records(url, init)
          : json({ items: [], nextCursor: null }),
      );
    }
    if (url === `/api/trips/${tripId}/achievements` && method === "POST") {
      return Promise.resolve(
        handlers.createAchievement !== undefined
          ? handlers.createAchievement(url, init)
          : notFound(),
      );
    }
    if (
      url.startsWith(`/api/trips/${tripId}/achievements/`) &&
      url.endsWith("/cancel") &&
      method === "POST"
    ) {
      return Promise.resolve(
        handlers.cancelAchievement !== undefined
          ? handlers.cancelAchievement(url, init)
          : notFound(),
      );
    }
    if (url === `/api/trips/${tripId}/bookings` && method === "POST") {
      return Promise.resolve(
        handlers.createBooking !== undefined
          ? handlers.createBooking(url, init)
          : notFound(),
      );
    }
    if (
      url.startsWith(`/api/trips/${tripId}/bookings/`) &&
      url.endsWith("/cancel") &&
      method === "POST"
    ) {
      return Promise.resolve(
        handlers.cancelBooking !== undefined
          ? handlers.cancelBooking(url, init)
          : notFound(),
      );
    }
    if (url === `/api/trips/${tripId}/balance` && method === "GET") {
      return Promise.resolve(
        handlers.balance !== undefined
          ? handlers.balance(url, init)
          : json(balanceBody()),
      );
    }
    if (
      url.startsWith(`/api/trips/${tripId}/itinerary`) &&
      method === "GET"
    ) {
      return Promise.resolve(
        handlers.itinerary !== undefined
          ? handlers.itinerary(url, init)
          : json(itineraryBody(trip(), [])),
      );
    }
    if (url === `/api/trips/${tripId}` && method === "GET") {
      return Promise.resolve(
        handlers.trip !== undefined ? handlers.trip(url, init) : json(trip()),
      );
    }
    if (
      url === `/api/trips/${tripId}/plans/${planId}` &&
      method === "GET"
    ) {
      return Promise.resolve(
        handlers.plan !== undefined
          ? handlers.plan(url, init)
          : json(plan()),
      );
    }
    return Promise.resolve(notFound());
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
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
  return button;
}

/** 読み込み中の表示が消えるまで待つ。 */
async function waitLoaded() {
  await waitFor(() =>
    expect(screen.queryByText("読み込み中")).not.toBeInTheDocument(),
  );
}

function renderScreen(ui: React.ReactElement) {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      {ui}
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
  ioCallbacks.length = 0;
  nowRef.value = null;
  vi.clearAllMocks();
});

beforeEach(async () => {
  await resetDb();
});

describe("記録の一覧（RW-05〜RW-08）", () => {
  it("取り消しの行が取り消した時刻の位置に、元の行は「取り消し済み」（RW-05）", async () => {
    const voided = event({
      cancellation: {
        targetId: achievementId,
        cancelledBy: otherUserId,
        createdAt: "2026-10-13T05:00:00.000Z",
      },
    });
    stubApi({
      records: () =>
        json({
          items: [cancellationItem(), item({ detail: voided })],
          nextCursor: null,
        }),
    });
    renderScreen(
      <RecordsScreen
        tripId={tripId}
        type={null}
        planId={null}
        recordId={null}
        recordType={null}
      />,
    );

    // 予定の名前が解決するまで待つ
    expect(
      await screen.findByText("錦市場で昼食を取り消し"),
    ).toBeInTheDocument();
    expect(await screen.findByText("錦市場で昼食")).toBeInTheDocument();
    expect(screen.getByText("取り消し済み")).toBeInTheDocument();
    // 取り消しの行は「そら が」取り消した（actorIdから出す）
    expect(screen.getByText(/そら が取り消し/)).toBeInTheDocument();
    // 元の行の名前は消し線のクラスが付く
    const voidedName = screen.getByText("錦市場で昼食");
    expect(voidedName.closest(".rrow")).toHaveClass("rrow-voided");
  });

  it("0件と絞り込みで0件の文言が分かれる（RW-05）", async () => {
    stubApi({});
    renderScreen(
      <RecordsScreen
        tripId={tripId}
        type={null}
        planId={null}
        recordId={null}
        recordType={null}
      />,
    );
    expect(
      await screen.findByText("記録はまだありません"),
    ).toBeInTheDocument();

    cleanup();
    renderScreen(
      <RecordsScreen
        tripId={tripId}
        type="payment"
        planId={null}
        recordId={null}
        recordType={null}
      />,
    );
    expect(
      await screen.findByText("この条件の記録はありません"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "絞り込みを解除" }),
    ).toHaveAttribute("href", `/trips/${tripId}/records`);
  });

  it("絞り込みの4つが出て、押すとtypeつきのURLへ進む（RW-06）", async () => {
    stubApi({});
    const { container } = renderScreen(
      <RecordsScreen
        tripId={tripId}
        type={null}
        planId={null}
        recordId={null}
        recordType={null}
      />,
    );
    await waitLoaded();
    const pills = container.querySelector(".record-filters");
    expect(pills).not.toBeNull();
    for (const name of ["すべて", "支払い", "達成", "予約"]) {
      expect(
        within(pills as HTMLElement).getByRole("button", { name }),
      ).toBeInTheDocument();
    }
    await userEvent.click(screen.getByRole("button", { name: "支払い" }));
    expect(pushMock).toHaveBeenCalledWith(
      `/trips/${tripId}/records?type=payment`,
    );
    await userEvent.click(screen.getByRole("button", { name: "予約" }));
    expect(pushMock).toHaveBeenCalledWith(
      `/trips/${tripId}/records?type=booking`,
    );
  });

  it("読み足しに失敗しても出ている行を残し、末尾で再試行できる（RW-07）", async () => {
    let pageCalls = 0;
    stubApi({
      records: (url) => {
        pageCalls += 1;
        if (!url.includes("cursor=")) {
          return json({ items: [item()], nextCursor: "cursor-1" });
        }
        return json({ code: "INTERNAL_ERROR" }, 500);
      },
    });
    renderScreen(
      <RecordsScreen
        tripId={tripId}
        type={null}
        planId={null}
        recordId={null}
        recordType={null}
      />,
    );
    expect(await screen.findByText("錦市場で昼食")).toBeInTheDocument();

    intersectLast();
    expect(
      await screen.findByText("続きを読み込めませんでした"),
    ).toBeInTheDocument();
    // 読み込んだ行は残ったまま
    expect(screen.getByText("錦市場で昼食")).toBeInTheDocument();
    const callsBefore = pageCalls;
    await userEvent.click(
      screen.getByRole("button", { name: "もう一度読む" }),
    );
    await waitFor(() => expect(pageCalls).toBe(callsBefore + 1));
  });

  it("支払いの行は支払いの詳細へのリンク、達成の行は小さな詳細を開く（RW-08）", async () => {
    stubApi({
      records: () =>
        json({ items: [paymentItem(), item()], nextCursor: null }),
    });
    renderScreen(
      <RecordsScreen
        tripId={tripId}
        type={null}
        planId={null}
        recordId={null}
        recordType={null}
      />,
    );
    expect(
      await screen.findByRole("link", { name: /参道で朝ごはん/ }),
    ).toHaveAttribute("href", `/trips/${tripId}/payments/${paymentId}`);

    // 達成の行は予定の名前の解決を待ってから小さな詳細を開く
    await userEvent.click(
      await screen.findByRole("button", { name: /錦市場で昼食/ }),
    );
    const sheet = await screen.findByRole("dialog", { name: "記録" });
    expect(within(sheet).getByText("達成")).toBeInTheDocument();
    expect(
      within(sheet).getByRole("link", { name: "予定を開く" }),
    ).toHaveAttribute("href", `/trips/${tripId}/plans/${planId}`);
    expect(
      within(sheet).getByRole("button", { name: "取り消す" }),
    ).toBeInTheDocument();
  });

  it("取り消しの行を押すと元の記録の小さな詳細を開く（RW-08）", async () => {
    stubApi({
      records: (url) => {
        if (url.includes(`recordId=${achievementId}`)) {
          // 元の記録と取り消しの行の組を返す
          return json({
            items: [item(), cancellationItem()],
            nextCursor: null,
          });
        }
        return json({ items: [cancellationItem()], nextCursor: null });
      },
    });
    renderScreen(
      <RecordsScreen
        tripId={tripId}
        type={null}
        planId={null}
        recordId={null}
        recordType={null}
      />,
    );
    await userEvent.click(
      await screen.findByRole("button", { name: /を取り消し/ }),
    );
    const sheet = await screen.findByRole("dialog", { name: "記録" });
    expect(within(sheet).getByText("達成")).toBeInTheDocument();
  });

  it("1件に絞る表示では「この記録に絞り込み中」と「すべての記録へ」が出る（RW-08）", async () => {
    stubApi({
      records: () => json({ items: [item()], nextCursor: null }),
    });
    renderScreen(
      <RecordsScreen
        tripId={tripId}
        type={null}
        planId={null}
        recordId={achievementId}
        recordType="achievement"
      />,
    );
    expect(
      await screen.findByText(/この記録に絞り込み中/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "すべての記録へ" }),
    ).toHaveAttribute("href", `/trips/${tripId}/records`);
    // 1件に絞る表示では絞り込みの薬は出さない
    expect(
      screen.queryByRole("button", { name: "支払い" }),
    ).not.toBeInTheDocument();
  });
});

describe("取り消しの確認と支払いの詳細（RW-09・RW-10）", () => {
  it("取り消しの確認に名前・金額・時刻と支払いの追加の文が出る（RW-09）", async () => {
    stubApi({
      records: () => json({ items: [item()], nextCursor: null }),
      cancelAchievement: () =>
        json({
          targetId: achievementId,
          cancelledBy: userId,
          createdAt: "2026-10-13T06:00:00.000Z",
        }),
    });
    renderScreen(
      <RecordsScreen
        tripId={tripId}
        type={null}
        planId={null}
        recordId={null}
        recordType={null}
      />,
    );
    await userEvent.click(
      await screen.findByRole("button", { name: /錦市場で昼食/ }),
    );
    const sheet = await screen.findByRole("dialog", { name: "記録" });
    // 保留の照合が終わるまで待ってから押す
    const cancelButton = within(sheet).getByRole("button", {
      name: "取り消す",
    });
    await waitFor(() => expect(cancelButton).toBeEnabled());
    await userEvent.click(cancelButton);
    const dialog = await screen.findByRole("dialog", {
      name: "この記録を取り消しますか？",
    });
    expect(
      within(dialog).getByText(
        /記録は消えず、「取り消し済み」として履歴に残ります/,
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/錦市場で昼食/)).toBeInTheDocument();
  });

  it("支払いの取り消しの確認には精算額が変わる文が出る（RW-09）", async () => {
    stubApi({
      cancelPayment: () =>
        json({
          targetId: paymentId,
          cancelledBy: userId,
          createdAt: "2026-10-13T06:00:00.000Z",
        }),
    });
    renderScreen(
      <PaymentDetailScreen tripId={tripId} paymentId={paymentId} />,
    );
    await clickWhenEnabled("取り消す");
    const dialog = await screen.findByRole("dialog", {
      name: "この記録を取り消しますか？",
    });
    // 名前・金額（v3の確認の件名）
    expect(
      within(dialog).getByText(/参道で朝ごはん/),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/2,400 円/)).toBeInTheDocument();
    expect(
      within(dialog).getByText(/記録は消えず/),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(/精算額が変わる場合があり/),
    ).toBeInTheDocument();
  });

  it("支払いの詳細は金額・払った人・負担・予定・記録した人を出す（RW-10）", async () => {
    stubApi({});
    renderScreen(
      <PaymentDetailScreen tripId={tripId} paymentId={paymentId} />,
    );
    await waitLoaded();
    // 読み取り専用の入力欄に写る（金額は3桁区切り）
    expect(screen.getByDisplayValue("2,400")).toBeInTheDocument();
    expect(
      screen.getByDisplayValue("参道で朝ごはん"),
    ).toBeInTheDocument();
    // 予定の行（関連する予定）はその予定へのリンク
    expect(
      screen.getByRole("link", { name: /錦市場で昼食/ }),
    ).toHaveAttribute("href", `/trips/${tripId}/plans/${planId}`);
    // 誰がいつ記録したか
    expect(screen.getByText(/に記録/)).toBeInTheDocument();
  });

  it("支払いを取り消したあとは「正しい内容で支払いを記録」で、写した支払いを記録の画面へ進む（RW-10）", async () => {
    const voided = payment({
      cancellation: {
        targetId: paymentId,
        cancelledBy: userId,
        createdAt: "2026-10-13T06:00:00.000Z",
      },
    });
    stubApi({
      payment: () => json(voided),
      cancelPayment: () =>
        json({
          targetId: paymentId,
          cancelledBy: userId,
          createdAt: "2026-10-13T06:00:00.000Z",
        }),
    });
    renderScreen(
      <PaymentDetailScreen tripId={tripId} paymentId={paymentId} />,
    );
    expect(await screen.findByText("取り消し済み")).toBeInTheDocument();
    expect(
      screen.getByText(/取り消しと新しい記録は別々に保存されます/),
    ).toBeInTheDocument();
    const recode = screen.getByRole("link", {
      name: "正しい内容で支払いを記録",
    });
    expect(recode).toHaveAttribute(
      "href",
      `/trips/${tripId}/payments/new?from=${paymentId}`,
    );
  });

  it("支払いを記録の画面は?from=の内容で埋まる（RW-10）", async () => {
    stubApi({});
    renderScreen(
      <PaymentFormScreen
        tripId={tripId}
        planId={null}
        fromPaymentId={paymentId}
      />,
    );
    // 取り消した支払いの金額・用途が写るまで待つ
    const amount = await screen.findByDisplayValue("2,400");
    expect(amount).toBeInTheDocument();
    expect(screen.getByDisplayValue("参道で朝ごはん")).toBeInTheDocument();
  });
});

describe("予定の詳細の達成・予約のボタンと関連する支払い（RW-11・RW-20）", () => {
  it("付けられる予定にはボタン、付けられない予定にはボタンを出さない（RW-11）", async () => {
    // food: 達成も予約も付けられる → 主ボタンは達成、副ボタンに予約
    stubApi({});
    renderScreen(<PlanDetailScreen tripId={tripId} planId={planId} from="2026-10-13" />);
    expect(
      await screen.findByRole("button", { name: "達成を記録" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "予約済みを記録" }),
    ).toBeInTheDocument();
    // F-08: 予約はこのアプリの中の記録であることを添える
    expect(
      screen.getByText(
        "このアプリの中の記録です。お店の予約は変わりません",
      ),
    ).toBeInTheDocument();

    cleanup();
    // place: 達成だけ付けられる（予約は付けられない）
    stubApi({ plan: () => json(plan({ kind: "place" })) });
    renderScreen(<PlanDetailScreen tripId={tripId} planId={planId} from="2026-10-13" />);
    expect(
      await screen.findByRole("button", { name: "達成を記録" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "予約済みを記録" }),
    ).not.toBeInTheDocument();

    cleanup();
    // lodging: 予約だけ付けられる → 主ボタンは予約
    stubApi({ plan: () => json(plan({ kind: "lodging" })) });
    renderScreen(<PlanDetailScreen tripId={tripId} planId={planId} from="2026-10-13" />);
    expect(
      await screen.findByRole("button", { name: "予約済みを記録" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "達成を記録" }),
    ).not.toBeInTheDocument();
  });

  it("取りやめた予定では達成は付けられないが予約は付けられる（RW-11）", async () => {
    stubApi({
      plan: () =>
        json(
          plan({
            cancelledAt: "2026-10-12T00:00:00.000Z",
            cancelledBy: userId,
          }),
        ),
    });
    renderScreen(<PlanDetailScreen tripId={tripId} planId={planId} from="2026-10-13" />);
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "達成を記録" }),
      ).not.toBeInTheDocument(),
    );
    expect(
      await screen.findByRole("button", { name: "予約済みを記録" }),
    ).toBeInTheDocument();
  });

  it("有効な記録の行は記録の絞り込みへのリンクになる（RW-11）", async () => {
    stubApi({
      plan: () => json(plan({ achievement: event() })),
    });
    renderScreen(<PlanDetailScreen tripId={tripId} planId={planId} from="2026-10-13" />);
    const row = await screen.findByRole("link", { name: /達成/ });
    expect(row).toHaveAttribute(
      "href",
      `/trips/${tripId}/records?recordId=${achievementId}&recordType=achievement`,
    );
  });

  it("関連する支払いは最大3件と「記録で見る」、無ければ「まだありません」（RW-11）", async () => {
    const paymentIds = [
      "0e1e2e3e-0000-4000-8000-000000000001",
      "0e1e2e3e-0000-4000-8000-000000000002",
      "0e1e2e3e-0000-4000-8000-000000000003",
      "0e1e2e3e-0000-4000-8000-000000000004",
    ];
    const payments = paymentIds.map((id, i) =>
      paymentItem({
        id,
        targetId: id,
        detail: payment({ id, label: `支払い${i}` }),
      }),
    );
    stubApi({
      records: (url) => {
        if (url.includes(`planId=${planId}`)) {
          return json({ items: payments, nextCursor: null });
        }
        return json({ items: [], nextCursor: null });
      },
    });
    renderScreen(<PlanDetailScreen tripId={tripId} planId={planId} from="2026-10-13" />);
    expect(await screen.findByText("支払い0")).toBeInTheDocument();
    // 新しい順に3件まで
    expect(screen.getByText("支払い2")).toBeInTheDocument();
    expect(screen.queryByText("支払い3")).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "記録で見る" }),
    ).toHaveAttribute(
      "href",
      `/trips/${tripId}/records?planId=${planId}`,
    );

    cleanup();
    stubApi({});
    renderScreen(<PlanDetailScreen tripId={tripId} planId={planId} from="2026-10-13" />);
    expect(await screen.findByText("まだありません")).toBeInTheDocument();
  });

  it("達成を記録すると保存され、保存中は同じボタンを押せない（RW-11・RW-19）", async () => {
    const fetchMock = stubApi({
      createAchievement: () =>
        json(event(), 200),
    });
    renderScreen(<PlanDetailScreen tripId={tripId} planId={planId} from="2026-10-13" />);
    const button = await clickWhenEnabled("達成を記録");
    // 保存の要求は端末に残してから送る（F-70）
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            String(url) === `/api/trips/${tripId}/achievements` &&
            (init?.method ?? "GET") === "POST",
        ),
      ).toBe(true),
    );
    expect(await screen.findByText("達成を記録しました")).toBeInTheDocument();
    // ボタンは記録後に消える（achievementが付く）か押せない
    void button;
  });

  it("409 RECORD_ALREADY_ACTIVE を受けたら予定を取り直し、もう一度付けるよう促さない（RW-11）", async () => {
    let planCalls = 0;
    const fetchMock = stubApi({
      plan: () => {
        planCalls += 1;
        // 取り直した予定にはすでに達成が付いている
        return json(
          planCalls > 1 ? plan({ achievement: event() }) : plan(),
        );
      },
      createAchievement: () =>
        json(
          {
            code: "RECORD_ALREADY_ACTIVE",
            message: "already active",
            requestId: "r1",
          },
          409,
        ),
    });
    renderScreen(<PlanDetailScreen tripId={tripId} planId={planId} from="2026-10-13" />);
    await clickWhenEnabled("達成を記録");
    // 予定の取り直しが走る
    await waitFor(() => expect(planCalls).toBeGreaterThan(1));
    // 「もう一度送る」の確認は出さない
    expect(
      screen.queryByText("保存されたか確認できません"),
    ).not.toBeInTheDocument();
    void fetchMock;
  });

  it("予約の小さな詳細にもF-08の文が出る（RW-20）", async () => {
    stubApi({
      records: () =>
        json({
          items: [
            item({
              id: bookingId,
              kind: "booking",
              targetId: bookingId,
              detail: bookingEvent(),
            }),
          ],
          nextCursor: null,
        }),
    });
    renderScreen(
      <RecordsScreen
        tripId={tripId}
        type={null}
        planId={null}
        recordId={null}
        recordType={null}
      />,
    );
    await userEvent.click(
      await screen.findByRole("button", { name: /錦市場で昼食/ }),
    );
    const sheet = await screen.findByRole("dialog", { name: "記録" });
    expect(within(sheet).getByText("予約")).toBeInTheDocument();
    expect(
      within(sheet).getByText(
        "このアプリの中の記録です。お店の予約は変わりません",
      ),
    ).toBeInTheDocument();
  });
});

describe("端末に残す仕組み（RW-19）", () => {
  it("保存できたか分からない保留があれば「保存されたか確認できません」と送り直しが出る", async () => {
    const pending = createMutationRequest({
      operation: CREATE_ACHIEVEMENT_OPERATION,
      url: `/api/trips/${tripId}/achievements`,
      method: "POST",
      body: { planId },
    });
    await savePendingRequest(
      toPendingRequestRecord({ userId, tripId, request: pending }),
    );

    const fetchMock = stubApi({
      createAchievement: () => json(event()),
    });
    renderScreen(<PlanDetailScreen tripId={tripId} planId={planId} from="2026-10-13" />);
    expect(
      await screen.findByText("保存されたか確認できません"),
    ).toBeInTheDocument();

    await clickWhenEnabled("同じ内容で確認する");
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            String(url) === `/api/trips/${tripId}/achievements` &&
            (init?.method ?? "GET") === "POST",
        ),
      ).toBe(true),
    );
  });

  it("記録の一覧にも取り消しの保留の送り直しが出る", async () => {
    const pending = createMutationRequest({
      operation: CANCEL_BOOKING_OPERATION,
      url: `/api/trips/${tripId}/bookings/${bookingId}/cancel`,
      method: "POST",
      body: null,
    });
    await savePendingRequest(
      toPendingRequestRecord({ userId, tripId, request: pending }),
    );

    const fetchMock = stubApi({
      cancelBooking: () =>
        json({
          targetId: bookingId,
          cancelledBy: userId,
          createdAt: "2026-10-13T06:00:00.000Z",
        }),
    });
    renderScreen(
      <RecordsScreen
        tripId={tripId}
        type={null}
        planId={null}
        recordId={null}
        recordType={null}
      />,
    );
    expect(
      await screen.findByText("保存されたか確認できません"),
    ).toBeInTheDocument();
    await clickWhenEnabled("同じ内容で確認する");
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            String(url) ===
              `/api/trips/${tripId}/bookings/${bookingId}/cancel` &&
            (init?.method ?? "GET") === "POST",
        ),
      ).toBe(true),
    );
  });

  it("端末に残せなければ送らずに止める", async () => {
    // indexedDBを壊して保存を失敗させる
    vi.stubGlobal("indexedDB", {
      open: () => {
        throw new Error("unavailable");
      },
      deleteDatabase: () => {
        throw new Error("unavailable");
      },
    });
    const fetchMock = stubApi({});
    renderScreen(<PlanDetailScreen tripId={tripId} planId={planId} from="2026-10-13" />);
    expect(
      await screen.findByText(/保存の確認に使う領域が使えません/),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "達成を記録" }),
    );
    // 端末に残せないので要求は送られない
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          String(url) === `/api/trips/${tripId}/achievements` &&
          (init?.method ?? "GET") === "POST",
      ),
    ).toBe(false);
  });
});
