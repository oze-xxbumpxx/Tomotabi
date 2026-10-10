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
import type { Itinerary, Trip } from "@tomotabi/contracts";
import { createQueryClient } from "@/shared/api/query-client";
import { createMutationRequest } from "@/shared/api/mutation-request";
import {
  savePendingRequest,
  toPendingRequestRecord,
} from "@/shared/browser/pending-requests";

const { pushMock, replaceMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  replaceMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
    replace: replaceMock,
    back: vi.fn(),
  }),
}));

vi.mock("@/shared/auth/auth-client", () => ({
  authClient: { signOut: vi.fn() },
}));

import { SettlementScreen } from "@/screens/settlement/settlement-screen";
import { SettlementPreviewScreen } from "@/screens/settlement-preview/settlement-preview-screen";
import { ItineraryScreen } from "@/screens/itinerary/itinerary-screen";

const userId = "550e8400-e29b-41d4-a716-446655440000";
const otherUserId = "3f7c1f68-9c05-4f2e-9b4c-2d5b1a90f811";
const tripId = "8a6e0804-2bd0-4672-b79d-d97027f9071a";
const previewId = "6d6a86a1-6d0b-4c0f-9bb9-9a1d3a9e9c01";
const secondPreviewId = "2f5e5a1c-1234-4abc-9def-0a1b2c3d4e5f";
const settlementId = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const paymentId = "11111111-2222-4333-8444-555555555555";
const secondPaymentId = "66666666-7777-4888-8999-000000000000";
const thirdPaymentId = "77777777-8888-4999-9aaa-111111111111";

const meBody = {
  user: { id: userId, displayName: "ひなた" },
  sessionExpiresAt: "2026-10-03T07:43:00.000Z",
};

// ひなた（slot 0・利用者本人）と あおい（slot 1）。
const participants = [
  { userId, slot: 0 as const, displayName: "ひなた" },
  { userId: otherUserId, slot: 1 as const, displayName: "あおい" },
];

type WirePayment = {
  id: string;
  tripId: string;
  planId: string | null;
  label: string | null;
  amountYen: string;
  payerUserId: string;
  allocations: {
    userId: string;
    percent: number;
    burdenYen: string;
  }[];
  createdBy: string;
  createdAt: string;
  cancellation: {
    targetId: string;
    cancelledBy: string;
    createdAt: string;
  } | null;
};

function payment(overrides: Partial<WirePayment> = {}): WirePayment {
  return {
    id: paymentId,
    tripId,
    planId: null,
    label: "錦市場で昼食",
    amountYen: "2000",
    payerUserId: otherUserId,
    allocations: [
      { userId, percent: 50, burdenYen: "1000" },
      { userId: otherUserId, percent: 50, burdenYen: "1000" },
    ],
    createdBy: otherUserId,
    createdAt: "2026-10-10T12:00:00.000Z",
    cancellation: null,
    ...overrides,
  };
}

function cancelledPayment(
  id: string,
  cancelledBy: string,
  overrides: Partial<WirePayment> = {},
): WirePayment {
  return payment({
    id,
    cancellation: {
      targetId: id,
      cancelledBy,
      createdAt: "2026-10-02T10:00:00.000Z",
    },
    ...overrides,
  });
}

function itemOf(p: WirePayment, contribution: string, kind = "BASE") {
  return {
    payment: p,
    kind,
    signedContributionYen: contribution,
    baseSettlementId: null,
  };
}

function transferOf(overrides: Partial<{
  signedTotalYen: string;
  amountYen: string;
  fromUserId: string | null;
  toUserId: string | null;
  requiresTransfer: boolean;
}> = {}) {
  return {
    // ひなた（slot 0）→ あおい（slot 1）へ1,285円（正の向きはslot1→slot0）。
    signedTotalYen: "-1285",
    amountYen: "1285",
    fromUserId: userId,
    toUserId: otherUserId,
    requiresTransfer: true,
    ...overrides,
  };
}

const zeroTransfer = {
  signedTotalYen: "0",
  amountYen: "0",
  fromUserId: null,
  toUserId: null,
  requiresTransfer: false,
};

/** 非0円の残額: あおいが2,570円払い、二人が1,285円ずつ負担 → ひなた→あおい1,285円。 */
function balanceBody(overrides: Record<string, unknown> = {}) {
  return {
    tripId,
    participants,
    transfer: transferOf(),
    targetCount: 2,
    items: [
      itemOf(payment(), "1285"),
      itemOf(
        payment({
          id: secondPaymentId,
          label: "美ら海水族館",
          amountYen: "570",
          allocations: [
            { userId, percent: 50, burdenYen: "285" },
            { userId: otherUserId, percent: 50, burdenYen: "285" },
          ],
        }),
        "1285",
      ),
    ],
    fetchedAt: "2026-10-01T12:00:00.000Z",
    ...overrides,
  };
}

function validationOf(status: string, overrides: Record<string, unknown> = {}) {
  return {
    status,
    cancelledPaymentIds: [],
    changedPaymentIds: [],
    existingSettlementId: null,
    ...overrides,
  };
}

function previewBody(overrides: Record<string, unknown> = {}) {
  return {
    id: previewId,
    tripId,
    createdBy: userId,
    createdAt: "2026-10-01T15:00:00.000Z",
    participants,
    transfer: transferOf(),
    items: balanceBody().items,
    validation: validationOf("ready"),
    ...overrides,
  };
}

function previewSummary(overrides: Record<string, unknown> = {}) {
  return {
    id: previewId,
    createdAt: "2026-10-01T15:00:00.000Z",
    transfer: transferOf(),
    targetCount: 2,
    validation: validationOf("ready"),
    ...overrides,
  };
}

function settlementBody(overrides: Record<string, unknown> = {}) {
  return {
    id: settlementId,
    tripId,
    previewId,
    sequence: "1",
    createdBy: userId,
    createdAt: "2026-10-01T16:00:00.000Z",
    completionKind: "transfer_completed",
    transfer: transferOf(),
    items: balanceBody().items,
    cancellation: null,
    canCancel: true,
    cannotCancelReason: null,
    ...overrides,
  };
}

function trip(): Trip {
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
  };
}

function itineraryBody(): Itinerary {
  return {
    trip: trip(),
    date: "2026-10-12",
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

type Handler = (
  init?: RequestInit,
  url?: string,
) => Response | Promise<Response>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function notFound(): Response {
  return json({ code: "NOT_FOUND" }, 404);
}

/** /api/meと精算まわりの経路をURL・メソッドで振り分けるfake。 */
function stubApi(handlers: {
  me?: Handler;
  balance?: Handler;
  previews?: Handler;
  preview?: Handler;
  settlements?: Handler;
  createPreview?: Handler;
  complete?: Handler;
  itinerary?: Handler;
  trip?: Handler;
}): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = urlOf(input);
    const method = init?.method ?? "GET";
    if (url === "/api/me") {
      return Promise.resolve(
        handlers.me !== undefined ? handlers.me(init) : json(meBody),
      );
    }
    if (url === `/api/trips/${tripId}/balance` && method === "GET") {
      return Promise.resolve(
        handlers.balance !== undefined
          ? handlers.balance(init)
          : json(balanceBody()),
      );
    }
    if (
      url === `/api/trips/${tripId}/settlement-previews/${previewId}` &&
      method === "GET"
    ) {
      return Promise.resolve(
        handlers.preview !== undefined
          ? handlers.preview(init)
          : json(previewBody()),
      );
    }
    if (
      url === `/api/trips/${tripId}/settlement-previews/${secondPreviewId}` &&
      method === "GET"
    ) {
      return Promise.resolve(
        handlers.preview !== undefined
          ? handlers.preview(init)
          : json(previewBody({ id: secondPreviewId })),
      );
    }
    if (
      url.startsWith(`/api/trips/${tripId}/settlement-previews`) &&
      method === "GET"
    ) {
      return Promise.resolve(
        handlers.previews !== undefined
          ? handlers.previews(init)
          : json({ items: [], nextCursor: null }),
      );
    }
    if (
      url.startsWith(`/api/trips/${tripId}/settlements`) &&
      method === "GET"
    ) {
      return Promise.resolve(
        handlers.settlements !== undefined
          ? handlers.settlements(init, url)
          : json({ items: [], nextCursor: null }),
      );
    }
    if (
      url === `/api/trips/${tripId}/settlement-previews` &&
      method === "POST"
    ) {
      return Promise.resolve(
        handlers.createPreview !== undefined
          ? handlers.createPreview(init)
          : json(previewBody(), 201),
      );
    }
    if (url === `/api/trips/${tripId}/settlements` && method === "POST") {
      return Promise.resolve(
        handlers.complete !== undefined
          ? handlers.complete(init)
          : json(settlementBody(), 201),
      );
    }
    if (
      url.startsWith(`/api/trips/${tripId}/itinerary`) &&
      method === "GET"
    ) {
      return Promise.resolve(
        handlers.itinerary !== undefined
          ? handlers.itinerary(init)
          : json(itineraryBody()),
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

async function seedPending(
  operation: string,
  url: string,
  body: unknown,
): Promise<void> {
  const request = createMutationRequest({
    operation,
    url,
    method: "POST",
    body,
  });
  await savePendingRequest(
    toPendingRequestRecord({ userId, tripId, request }),
  );
}

function renderSettlement() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <SettlementScreen tripId={tripId} />
    </QueryClientProvider>,
  );
}

function renderPreview(id = previewId) {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <SettlementPreviewScreen tripId={tripId} previewId={id} />
    </QueryClientProvider>,
  );
}

afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  window.localStorage.clear();
  await resetDb();
});

describe("精算の画面（14・14f・14g・14i）", () => {
  it("FW-05: 対象 0 件は「現在、精算する対象はありません」で確認は作れない", async () => {
    const fetchMock = stubApi({
      balance: () => json(balanceBody({ targetCount: 0, items: [], transfer: zeroTransfer })),
    });
    renderSettlement();

    expect(
      await screen.findByText("現在、精算する対象はありません"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("支払いを記録すると、ここに受け渡しの額が出ます。"),
    ).toBeInTheDocument();
    // 対象0件では確認の作成を出さない。
    expect(
      screen.queryByRole("button", { name: /確認する/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("精算の履歴はまだありません"),
    ).toBeInTheDocument();
    await waitFor(() => expect(writeCalls(fetchMock)).toHaveLength(0));
  });

  it("FW-05: 非 0 円は向きと金額・内訳・明細を出し、「受け渡しを確認する」で確認を作って開く", async () => {
    const createCalls: RequestInit[] = [];
    const fetchMock = stubApi({
      createPreview: (init) => {
        if (init !== undefined) {
          createCalls.push(init);
        }
        return json(previewBody(), 201);
      },
    });
    const user = userEvent.setup();
    renderSettlement();

    // 向きと金額。
    expect(
      (await screen.findAllByText("1,285 円")).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("対象 2 件")).toBeInTheDocument();
    expect(screen.getByText("から")).toBeInTheDocument();
    expect(screen.getByText("へ")).toBeInTheDocument();

    // 内訳: あおいが多く払ったので受け取り、ひなたは渡す。
    expect(screen.getAllByText("支払った額")).toHaveLength(2);
    expect(screen.getByText("受け取る 1,285 円")).toBeInTheDocument();
    expect(screen.getByText("渡す 1,285 円")).toBeInTheDocument();
    expect(
      screen.getByText(
        "支払いの合計 2,570 円 ＝ 二人の負担額の合計 2,570 円",
      ),
    ).toBeInTheDocument();

    // 明細（支払いごとの名前・金額・二人の負担）。
    expect(screen.getByText("錦市場で昼食")).toBeInTheDocument();
    expect(screen.getByText("美ら海水族館")).toBeInTheDocument();
    expect(screen.getAllByText(/あおい が支払い · 折半/)).toHaveLength(2);
    expect(
      screen.getByText("ひなた 1,000 円 · あおい 1,000 円"),
    ).toBeInTheDocument();

    const createButton = await screen.findByRole("button", {
      name: "受け渡しを確認する",
    });
    await waitFor(() => expect(createButton).toBeEnabled());
    await user.click(createButton);

    // POST /settlement-previews（bodyなし・Idempotency-Keyつき）→ その確認へ進む。
    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith(
        `/trips/${tripId}/settlement/previews/${previewId}`,
      ),
    );
    expect(createCalls).toHaveLength(1);
    expect(createCalls[0]?.body).toBeUndefined();
    const headers = new Headers(createCalls[0]?.headers);
    expect(headers.get("Idempotency-Key")).not.toBeNull();

    // 作成のあとは確認の一覧を取り直す。
    const previewFetches = fetchMock.mock.calls.filter(
      ([url]) =>
        urlOf(url).startsWith(`/api/trips/${tripId}/settlement-previews`) &&
        !urlOf(url).includes(previewId),
    );
    expect(previewFetches.length).toBeGreaterThanOrEqual(2);
  });

  it("内訳の「差」は符号なしで出し、札と説明の行に向きの矢印を付ける", async () => {
    stubApi({});
    const { container } = renderSettlement();
    await screen.findAllByText("1,285 円");

    // ひなたの差は-1,285だが、差の欄はどちらも符号なし（向きは札が示す）。
    expect(screen.queryByText("-1,285 円")).not.toBeInTheDocument();
    const diffTiles = screen
      .getAllByText("差")
      .map((label) => label.closest(".settle-tile"));
    expect(diffTiles).toHaveLength(2);
    for (const tile of diffTiles) {
      expect(
        within(tile as HTMLElement).getByText("1,285 円"),
      ).toBeInTheDocument();
    }

    // 「渡す」「受け取る」の札に向きの矢印が付く。
    const badges = container.querySelectorAll(".settle-badge");
    expect(badges).toHaveLength(2);
    for (const badge of badges) {
      expect(badge.querySelector("svg")).not.toBeNull();
    }

    // 説明の行の頭に折れ曲がった矢印が付く。
    for (const sentence of container.querySelectorAll(
      ".settle-breakdown-sentence",
    )) {
      expect(sentence.querySelector("svg")).not.toBeNull();
    }
  });

  it("FW-05: 0 円は「受け渡しは不要です」と専用の主操作を出す", async () => {
    stubApi({
      balance: () =>
        json(
          balanceBody({
            transfer: zeroTransfer,
            targetCount: 1,
            items: [
              itemOf(
                payment({
                  payerUserId: userId,
                  amountYen: "1000",
                  allocations: [
                    { userId, percent: 100, burdenYen: "1000" },
                    { userId: otherUserId, percent: 0, burdenYen: "0" },
                  ],
                }),
                "0",
              ),
            ],
          }),
        ),
    });
    renderSettlement();

    expect(
      (await screen.findAllByText("0 円")).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("受け渡しは不要です")).toBeInTheDocument();
    expect(
      screen.getByText("未処理の対象が 1 件あります"),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("button", {
        name: "受け渡し不要の対象を確認する",
      }),
    ).toBeInTheDocument();
  });

  it("FW-05: 残額の取得失敗はその欄だけ失敗にして再試行し、確認へは進めない", async () => {
    let balanceCalls = 0;
    stubApi({
      balance: () => {
        balanceCalls += 1;
        return balanceCalls === 1
          ? json({ code: "INTERNAL" }, 500)
          : json(balanceBody());
      },
    });
    const user = userEvent.setup();
    renderSettlement();

    expect(
      await screen.findByText("精算額を取得できませんでした"),
    ).toBeInTheDocument();
    // 取得失敗では確認へ進めない。
    expect(
      screen.queryByRole("button", { name: /確認する/ }),
    ).not.toBeInTheDocument();
    // 失敗していない欄は表示を続ける。
    expect(
      await screen.findByText("精算の履歴はまだありません"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "再試行" }));
    expect(
      (await screen.findAllByText("1,285 円")).length,
    ).toBeGreaterThan(0);
    expect(
      await screen.findByRole("button", { name: "受け渡しを確認する" }),
    ).toBeInTheDocument();
  });

  it("自分の未完了の確認と精算の履歴を欄ごとに出す", async () => {
    stubApi({
      previews: () =>
        json({
          items: [
            previewSummary(),
            previewSummary({
              id: secondPreviewId,
              transfer: zeroTransfer,
              validation: validationOf("target_changed", {
                changedPaymentIds: [paymentId],
              }),
            }),
          ],
          nextCursor: null,
        }),
      settlements: () =>
        json({
          items: [
            settlementBody(),
            settlementBody({
              id: "2f5e5a1c-1234-4abc-9def-0a1b2c3d4e5f",
              sequence: "2",
              cancellation: {
                targetId: settlementId,
                cancelledBy: userId,
                createdAt: "2026-10-01T17:00:00.000Z",
              },
              canCancel: false,
              cannotCancelReason: "already_cancelled",
            }),
          ],
          nextCursor: null,
        }),
    });
    renderSettlement();

    expect(await screen.findByText("未完了の確認")).toBeInTheDocument();
    const links = screen.getAllByRole("link", {
      name: /ひなた から あおい へ 1,285 円|受け渡し不要/,
    });
    expect(links[0]).toHaveAttribute(
      "href",
      `/trips/${tripId}/settlement/previews/${previewId}`,
    );
    // 記録できない確認はその印を添える。
    expect(screen.getByText("記録できません")).toBeInTheDocument();

    expect(screen.getByText("精算の履歴")).toBeInTheDocument();
    expect(screen.getByText("取り消し済み")).toBeInTheDocument();
  });

  it("通知から開いた精算が読み込み済みの頁に無ければ、見つかるまで続きを取る", async () => {
    Element.prototype.scrollIntoView = vi.fn();
    const oldSettlementId = "99999999-8888-4777-8666-555555555555";
    const requestedCursors: (string | null)[] = [];
    stubApi({
      settlements: (_init, url) => {
        const cursor = new URL(url ?? "", "http://localhost").searchParams.get(
          "cursor",
        );
        requestedCursors.push(cursor);
        if (cursor === "c2") {
          return json({
            items: [settlementBody({ id: oldSettlementId })],
            nextCursor: null,
          });
        }
        return json({ items: [settlementBody()], nextCursor: "c2" });
      },
    });
    render(
      <QueryClientProvider client={createQueryClient()}>
        <SettlementScreen
          tripId={tripId}
          focusSettlementId={oldSettlementId}
        />
      </QueryClientProvider>,
    );

    // 1頁目に無いので2頁目（cursor=c2）が自動で取られ、
    // 見つかった行にaria-currentが付く。
    await waitFor(() => {
      expect(requestedCursors).toContain("c2");
    });
    await waitFor(() => {
      const section = screen
        .getByText("精算の履歴")
        .closest("section") as HTMLElement;
      const rows = within(section).getAllByRole("listitem");
      expect(rows).toHaveLength(2);
      expect(rows[1].getAttribute("aria-current")).toBe("true");
      expect(rows[0].getAttribute("aria-current")).toBeNull();
    });
  });

  it("下部のタブに「精算」を出し、しおりのタブからも辿れる", async () => {
    stubApi({});
    const { unmount } = render(
      <QueryClientProvider client={createQueryClient()}>
        <ItineraryScreen tripId={tripId} date="2026-10-12" />
      </QueryClientProvider>,
    );

    expect(
      await screen.findByRole("link", { name: "精算" }),
    ).toHaveAttribute("href", `/trips/${tripId}/settlement`);
    unmount();

    stubApi({});
    renderSettlement();
    await screen.findAllByText("1,285 円");
    const nav = screen.getByRole("navigation", { name: "タブ" });
    expect(
      within(nav).getByText("精算").closest("[aria-current]"),
    ).toHaveAttribute("aria-current", "page");
    expect(
      within(nav).getByRole("link", { name: "しおり" }),
    ).toHaveAttribute("href", `/trips/${tripId}/itinerary`);
  });

  it("確認の作成の保留があるあいだは操作を固定し、本人の操作で同じ要求だけ送る", async () => {
    const createCalls: RequestInit[] = [];
    stubApi({
      createPreview: (init) => {
        if (init !== undefined) {
          createCalls.push(init);
        }
        return json(previewBody(), 201);
      },
    });
    await seedPending(
      "createSettlementPreview",
      `/api/trips/${tripId}/settlement-previews`,
      null,
    );
    const user = userEvent.setup();
    renderSettlement();
    await screen.findAllByText("1,285 円");

    // 保留があるあいだは入力を固定して「同じ内容で確認する」だけ出す。
    expect(
      await screen.findByText("保存されたか確認できません"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "受け渡しを確認する" }),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "同じ内容で確認する" }),
    );
    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith(
        `/trips/${tripId}/settlement/previews/${previewId}`,
      ),
    );
    expect(createCalls).toHaveLength(1);
  });

  it("送る直前に IndexedDB へ保存できなければ送らない", async () => {
    const fetchMock = stubApi({});
    const putSpy = vi
      .spyOn(IDBObjectStore.prototype, "put")
      .mockImplementation(() => {
        throw new DOMException("writes blocked", "InvalidStateError");
      });
    const user = userEvent.setup();
    renderSettlement();
    try {
      const button = await screen.findByRole("button", {
        name: "受け渡しを確認する",
      });
      await waitFor(() => expect(button).toBeEnabled());
      await user.click(button);

      expect(
        await screen.findByText(
          "この端末では保存の確認に使う領域が使えません",
        ),
      ).toBeInTheDocument();
      expect(writeCalls(fetchMock)).toHaveLength(0);
    } finally {
      putSpy.mockRestore();
    }
  });
});

describe("受け渡しの確認（14c・14d・14e・14f・14h）", () => {
  it("FW-06: 非 0 円はチェックするまで完了を押せず、記録の前に確認のダイアログを出す", async () => {
    const completeCalls: RequestInit[] = [];
    stubApi({
      complete: (init) => {
        if (init !== undefined) {
          completeCalls.push(init);
        }
        return json(settlementBody(), 201);
      },
    });
    const user = userEvent.setup();
    renderPreview();

    // 固定した向き・金額・対象の明細。
    expect(
      (await screen.findAllByText("1,285 円")).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText(/対象 2 件/)).toBeInTheDocument();
    expect(
      screen.getByText("作成した時点の対象と金額で固定しています"),
    ).toBeInTheDocument();
    expect(screen.getByText("錦市場で昼食")).toBeInTheDocument();

    const record = await screen.findByRole("button", {
      name: "受け渡し完了を記録",
    });
    // チェックするまで完了を押せない。
    await waitFor(() =>
      expect(
        screen.getByRole("checkbox", {
          name: "表示の全額を受け渡しました",
        }),
      ).toBeEnabled(),
    );
    expect(record).toBeDisabled();
    // ボタンにはチェックの印が付く（押せないあいだも）。
    expect(record.querySelector("svg")).not.toBeNull();
    await user.click(
      screen.getByRole("checkbox", { name: "表示の全額を受け渡しました" }),
    );
    expect(record).toBeEnabled();

    // 記録の前に確認のダイアログ。まだ送らない。
    await user.click(record);
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText("受け渡し完了を記録しますか？"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        /ひなた から あおい へ 1,285 円を受け渡したことを記録します/,
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(/このアプリは送金を行いません。/),
    ).toBeInTheDocument();

    await user.click(
      within(dialog).getByRole("button", { name: "記録する" }),
    );
    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith(`/trips/${tripId}/settlement`),
    );

    // 精算の完了はpreviewIdとcompletionKindを送る。
    expect(completeCalls).toHaveLength(1);
    const body = JSON.parse(String(completeCalls[0]?.body));
    expect(body).toEqual({
      previewId,
      completionKind: "transfer_completed",
      acknowledgedCancellationPaymentIds: [],
    });
  });

  it("金額のカードは向きの行・大きな金額・固定の注記を左寄せで出す（v3 の 14c）", async () => {
    stubApi({});
    const { container } = renderPreview();
    await screen.findAllByText("1,285 円");

    // 1行目は「{name} から {name} へ」（名前は太字、間に矢印）。
    const direction = container.querySelector(".settle-direction");
    expect(direction?.textContent).toMatch(
      /ひなた\s*から\s*あおい\s*へ/,
    );
    expect(
      [...(direction?.querySelectorAll("strong") ?? [])].map(
        (el) => el.textContent,
      ),
    ).toEqual(["ひなた", "あおい"]);
    expect(direction?.querySelector("svg")).not.toBeNull();

    // 金額は左寄せの大きな表示で、固定の注記も左寄せ。
    expect(
      container.querySelector(".settle-amount.settle-amount-fixed"),
    ).not.toBeNull();
    expect(
      screen.getByText("作成した時点の対象と金額で固定しています"),
    ).toBeInTheDocument();
  });

  it("対象の明細は各行「負担 … 円」の1行にまとめる（v3 の 14c）", async () => {
    stubApi({});
    renderPreview();
    await screen.findAllByText("1,285 円");

    expect(
      screen.getByText("負担 ひなた 1,000 · あおい 1,000 円"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("負担 ひなた 285 · あおい 285 円"),
    ).toBeInTheDocument();
    // 受け渡しがある確認では「{name} が支払い · 折半」の行は出さない。
    expect(screen.queryByText(/が支払い/)).not.toBeInTheDocument();
  });

  it("FW-06: 0 円はチェックなしで「受け渡し不要として精算を記録」", async () => {
    const completeCalls: RequestInit[] = [];
    stubApi({
      preview: () =>
        json(
          previewBody({
            transfer: zeroTransfer,
            items: [
              itemOf(
                payment({
                  payerUserId: userId,
                  amountYen: "1000",
                  allocations: [
                    { userId, percent: 100, burdenYen: "1000" },
                    { userId: otherUserId, percent: 0, burdenYen: "0" },
                  ],
                }),
                "0",
              ),
            ],
          }),
        ),
      complete: (init) => {
        if (init !== undefined) {
          completeCalls.push(init);
        }
        return json(
          settlementBody({
            completionKind: "no_transfer_required",
            transfer: zeroTransfer,
          }),
          201,
        );
      },
    });
    const user = userEvent.setup();
    renderPreview();

    expect(await screen.findByText("受け渡しは不要です")).toBeInTheDocument();
    // 0円はチェックなし。
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    // 明細の「負担 …」の行末に「{name} が支払い」を添える（v3 の 14h）。
    expect(
      screen.getByText("負担 ひなた 1,000 · あおい 0 円 · ひなた が支払い"),
    ).toBeInTheDocument();

    const record = await screen.findByRole("button", {
      name: "受け渡し不要として精算を記録",
    });
    await waitFor(() => expect(record).toBeEnabled());
    await user.click(record);

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText("精算を記録しますか？"),
    ).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("button", { name: "記録する" }),
    );

    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith(`/trips/${tripId}/settlement`),
    );
    const body = JSON.parse(String(completeCalls[0]?.body));
    expect(body.completionKind).toBe("no_transfer_required");
  });

  it("やめる で閉じれば送らない", async () => {
    const fetchMock = stubApi({});
    const user = userEvent.setup();
    renderPreview();

    const record = await screen.findByRole("button", {
      name: "受け渡し完了を記録",
    });
    // 保留中の要求の確認が終わるまでチェックは押せない（押しても効かない）。
    await waitFor(() =>
      expect(
        screen.getByRole("checkbox", {
          name: "表示の全額を受け渡しました",
        }),
      ).toBeEnabled(),
    );
    await user.click(
      screen.getByRole("checkbox", {
        name: "表示の全額を受け渡しました",
      }),
    );
    await user.click(record);
    const dialog = await screen.findByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "やめる" }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(writeCalls(fetchMock)).toHaveLength(0);
  });

  it("FW-07: 対象の変化のときは記録できない表示と精算への導線だけ", async () => {
    stubApi({
      preview: () =>
        json(
          previewBody({
            validation: validationOf("target_changed", {
              changedPaymentIds: [paymentId],
            }),
          }),
        ),
    });
    renderPreview();
    await screen.findByText(
      "この確認では記録できません。精算の画面に戻って確認し直してください。",
    );
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /記録/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "精算の画面へ" }),
    ).toHaveAttribute("href", `/trips/${tripId}/settlement`);
  });

  it("FW-07: すでに記録済みの確認は既存の精算への導線を出す", async () => {
    stubApi({
      preview: () =>
        json(
          previewBody({
            validation: validationOf("already_completed", {
              existingSettlementId: settlementId,
            }),
          }),
        ),
    });
    renderPreview();

    expect(
      await screen.findByText(
        "この確認はすでに精算として記録されています。",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "精算の画面へ" }),
    ).toHaveAttribute("href", `/trips/${tripId}/settlement`);
    expect(
      screen.queryByRole("button", { name: /記録/ }),
    ).not.toBeInTheDocument();
  });

  it("精算の完了の保留があるあいだは入力を固定し、本人の操作で同じ要求だけ送る", async () => {
    const completeCalls: RequestInit[] = [];
    stubApi({
      complete: (init) => {
        if (init !== undefined) {
          completeCalls.push(init);
        }
        return json(settlementBody(), 201);
      },
    });
    await seedPending("completeSettlement", `/api/trips/${tripId}/settlements`, {
      previewId,
      completionKind: "transfer_completed",
      acknowledgedCancellationPaymentIds: [],
    });
    const user = userEvent.setup();
    renderPreview();
    await screen.findAllByText("1,285 円");

    expect(
      await screen.findByText("保存されたか確認できません"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /記録/ }),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "同じ内容で確認する" }),
    );
    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith(`/trips/${tripId}/settlement`),
    );
    // 同じ要求を1回だけ送る。
    expect(completeCalls).toHaveLength(1);
    const body = JSON.parse(String(completeCalls[0]?.body));
    expect(body.previewId).toBe(previewId);
  });

  it("保存の確認が使えないときは送らない", async () => {
    vi.stubGlobal("indexedDB", undefined);
    const fetchMock = stubApi({});
    renderPreview();
    await screen.findAllByText("1,285 円");

    expect(
      await screen.findByText(
        "この端末では保存の確認に使う領域が使えません",
      ),
    ).toBeInTheDocument();
    // 保存を確かめられないあいだは記録の操作を出さない。
    expect(
      screen.queryByRole("button", { name: /記録/ }),
    ).not.toBeInTheDocument();
    expect(writeCalls(fetchMock)).toHaveLength(0);
  });

  it("RW-16: 確認を作ったあとに追加された支払いの件数の案内を出す。金額は変わらない", async () => {
    const addedPayment = payment({
      id: thirdPaymentId,
      label: "抹茶パフェ",
      amountYen: "1200",
      allocations: [
        { userId, percent: 50, burdenYen: "600" },
        { userId: otherUserId, percent: 50, burdenYen: "600" },
      ],
    });
    stubApi({
      balance: () =>
        json(
          balanceBody({
            targetCount: 3,
            items: [...balanceBody().items, itemOf(addedPayment, "600")],
          }),
        ),
    });
    const first = renderPreview();

    await screen.findAllByText("1,285 円");
    const notice = await screen.findByRole("status");
    expect(notice).toHaveTextContent(
      "確認を作ったあとに支払いが 1 件追加されました。",
    );
    expect(notice).toHaveTextContent("次回の精算に含まれます。");
    expect(notice).toHaveTextContent("この画面の金額は変わりません。");
    // 確認の金額・明細は固定のまま（追加された支払いは明細に出ない）。
    expect(screen.getAllByText("1,285 円").length).toBeGreaterThan(0);
    expect(screen.queryByText("抹茶パフェ")).not.toBeInTheDocument();
    first.unmount();

    // 追加分が0件なら案内を出さない。
    const secondFetch = stubApi({});
    renderPreview();
    await screen.findAllByText("1,285 円");
    // 残額の取得が済んでから案内の無いことを見る。
    await waitFor(() =>
      expect(
        secondFetch.mock.calls.filter(
          ([input]) => urlOf(input) === `/api/trips/${tripId}/balance`,
        ),
      ).toHaveLength(1),
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("RW-17: 取り消された明細を出し、作り直しの道と、確かめるまで押せない記録の道を出す", async () => {
    const completeCalls: RequestInit[] = [];
    // 残額には取り消された支払いは無く、確認のあとに追加された支払いがある。
    const balanceWithAddition = balanceBody({
      targetCount: 2,
      items: [
        itemOf(
          payment({
            id: secondPaymentId,
            label: "美ら海水族館",
            amountYen: "570",
            allocations: [
              { userId, percent: 50, burdenYen: "285" },
              { userId: otherUserId, percent: 50, burdenYen: "285" },
            ],
          }),
          "1285",
        ),
        itemOf(
          payment({ id: thirdPaymentId, label: "抹茶パフェ", amountYen: "1200" }),
          "600",
        ),
      ],
    });
    stubApi({
      preview: () =>
        json(
          previewBody({
            id: secondPreviewId,
            items: [
              itemOf(cancelledPayment(paymentId, otherUserId), "1285"),
              itemOf(
                payment({
                  id: secondPaymentId,
                  label: "美ら海水族館",
                  amountYen: "570",
                  allocations: [
                    { userId, percent: 50, burdenYen: "285" },
                    { userId: otherUserId, percent: 50, burdenYen: "285" },
                  ],
                }),
                "1285",
              ),
            ],
            validation: validationOf("cancelled_items_ack_required", {
              cancelledPaymentIds: [paymentId],
            }),
          }),
        ),
      balance: () => json(balanceWithAddition),
      complete: (init) => {
        if (init !== undefined) {
          completeCalls.push(init);
        }
        return json(settlementBody({ previewId: secondPreviewId }), 201);
      },
    });
    const user = userEvent.setup();
    renderPreview(secondPreviewId);

    // 取り消された明細: 名前・金額・誰がいつ取り消したか。
    expect(
      await screen.findByText("対象の支払いが取り消されました"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/あおい が .+ に取り消しました/),
    ).toBeInTheDocument();
    // 追加の件数の案内も出る（F-60、数えられる状態）。
    expect(await screen.findByRole("status")).toHaveTextContent(
      "支払いが 1 件追加されました",
    );

    // まだ受け渡していないときは最新の残額で確認を作り直す。
    expect(
      screen.getByRole("link", { name: "最新の残額で確認を作り直す" }),
    ).toHaveAttribute("href", `/trips/${tripId}/settlement`);

    // チェックを付けるまで記録できない。
    const record = screen.getByRole("button", {
      name: "了承して受け渡し完了を記録",
    });
    expect(record).toBeDisabled();
    const ackCheck = await screen.findByRole("checkbox", {
      name: "錦市場で昼食の取り消しを確かめました",
    });
    await waitFor(() => expect(ackCheck).toBeEnabled());
    expect(record).toBeDisabled();
    await user.click(ackCheck);
    expect(record).toBeEnabled();

    await user.click(record);
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText("受け渡し完了を記録しますか？"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        /取り消された支払い 1 件を了承したこともあわせて記録します/,
      ),
    ).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("button", { name: "記録する" }),
    );

    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith(`/trips/${tripId}/settlement`),
    );
    // 了承した支払いのIDをacknowledgedCancellationPaymentIdsで送る。
    expect(completeCalls).toHaveLength(1);
    const body = JSON.parse(String(completeCalls[0]?.body));
    expect(body).toEqual({
      previewId: secondPreviewId,
      completionKind: "transfer_completed",
      acknowledgedCancellationPaymentIds: [paymentId],
    });
  });

  it("RW-17: 取り直して取り消しの一覧が変わったらチェックを外して確かめ直す", async () => {
    const completeCalls: RequestInit[] = [];
    const itemSecond = itemOf(
      payment({
        id: secondPaymentId,
        label: "美ら海水族館",
        amountYen: "570",
        allocations: [
          { userId, percent: 50, burdenYen: "285" },
          { userId: otherUserId, percent: 50, burdenYen: "285" },
        ],
      }),
      "1285",
    );
    const cancelledItems = [
      itemOf(cancelledPayment(paymentId, otherUserId), "1285"),
      itemOf(
        cancelledPayment(secondPaymentId, userId, {
          label: "美ら海水族館",
          amountYen: "570",
          allocations: [
            { userId, percent: 50, burdenYen: "285" },
            { userId: otherUserId, percent: 50, burdenYen: "285" },
          ],
        }),
        "1285",
      ),
    ];
    let previewCalls = 0;
    stubApi({
      preview: () => {
        previewCalls += 1;
        // 取り直した確認では取り消された対象が1件増えている。
        return previewCalls === 1
          ? json(
              previewBody({
                id: secondPreviewId,
                items: [itemOf(cancelledPayment(paymentId, otherUserId), "1285"), itemSecond],
                validation: validationOf("cancelled_items_ack_required", {
                  cancelledPaymentIds: [paymentId],
                }),
              }),
            )
          : json(
              previewBody({
                id: secondPreviewId,
                items: cancelledItems,
                validation: validationOf("cancelled_items_ack_required", {
                  cancelledPaymentIds: [paymentId, secondPaymentId],
                }),
              }),
            );
      },
      complete: (init) => {
        if (init !== undefined) {
          completeCalls.push(init);
        }
        return completeCalls.length === 1
          ? json({ code: "CANCELLED_ITEMS_ACK_REQUIRED" }, 409)
          : json(settlementBody({ previewId: secondPreviewId }), 201);
      },
    });
    const user = userEvent.setup();
    renderPreview(secondPreviewId);

    const firstCheck = await screen.findByRole("checkbox", {
      name: "錦市場で昼食の取り消しを確かめました",
    });
    await waitFor(() => expect(firstCheck).toBeEnabled());
    await user.click(firstCheck);
    await user.click(
      screen.getByRole("button", { name: "了承して受け渡し完了を記録" }),
    );
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "記録する",
      }),
    );

    // 409で確認を取り直すと、増えた取り消しのチェックが現れ、
    // 付けていたチェックは外れている（新しい取り消しを自動で了承しない）。
    const secondCheck = await screen.findByRole("checkbox", {
      name: "美ら海水族館の取り消しを確かめました",
    });
    expect(secondCheck).not.toBeChecked();
    expect(
      screen.getByRole("checkbox", {
        name: "錦市場で昼食の取り消しを確かめました",
      }),
    ).not.toBeChecked();
    expect(
      screen.getByRole("button", { name: "了承して受け渡し完了を記録" }),
    ).toBeDisabled();

    await waitFor(() => expect(secondCheck).toBeEnabled());
    await user.click(
      screen.getByRole("checkbox", {
        name: "錦市場で昼食の取り消しを確かめました",
      }),
    );
    await user.click(secondCheck);
    await user.click(
      screen.getByRole("button", { name: "了承して受け渡し完了を記録" }),
    );
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "記録する",
      }),
    );

    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith(`/trips/${tripId}/settlement`),
    );
    expect(completeCalls).toHaveLength(2);
    const retryBody = JSON.parse(String(completeCalls[1]?.body));
    expect(retryBody.acknowledgedCancellationPaymentIds).toEqual([
      paymentId,
      secondPaymentId,
    ]);
  });

  it("RW-18: 0円の確認では了承を出さず作り直しだけ。ほかの状態では残額を数えない", async () => {
    // 0円の確認で対象が取り消された: 了承のチェックは無く、作り直しだけ。
    const firstFetch = stubApi({
      preview: () =>
        json(
          previewBody({
            id: secondPreviewId,
            transfer: zeroTransfer,
            items: [itemOf(cancelledPayment(paymentId, otherUserId), "0")],
            validation: validationOf("cancelled_items_ack_required", {
              cancelledPaymentIds: [paymentId],
            }),
          }),
        ),
      balance: () =>
        json(balanceBody({ targetCount: 0, items: [], transfer: zeroTransfer })),
    });
    const first = renderPreview(secondPreviewId);

    expect(
      await screen.findByText("対象の支払いが取り消されました"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "最新の残額で確認を作り直す" }),
    ).toHaveAttribute("href", `/trips/${tripId}/settlement`);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /記録/ }),
    ).not.toBeInTheDocument();
    // 追加分0件なら案内も出さない。
    await waitFor(() =>
      expect(
        firstFetch.mock.calls.filter(
          ([input]) => urlOf(input) === `/api/trips/${tripId}/balance`,
        ),
      ).toHaveLength(1),
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    first.unmount();

    // target_changed・already_completed・completed_then_cancelledでは
    // 残額を取らず、追加の案内も出さない。
    for (const [status, text] of [
      [
        "target_changed",
        "この確認では記録できません。精算の画面に戻って確認し直してください。",
      ],
      [
        "already_completed",
        "この確認はすでに精算として記録されています。",
      ],
      [
        "completed_then_cancelled",
        "この確認の精算は取り消されています。",
      ],
    ] as const) {
      const fetchMock = stubApi({
        preview: () =>
          json(
            previewBody({ validation: validationOf(status) }),
          ),
      });
      const { unmount } = renderPreview();
      await screen.findByText(text);
      expect(
        fetchMock.mock.calls.filter(
          ([input]) => urlOf(input) === `/api/trips/${tripId}/balance`,
        ),
      ).toHaveLength(0);
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
      unmount();
    }
  });
});
