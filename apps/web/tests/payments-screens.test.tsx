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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Itinerary, Plan, Trip } from "@tomotabi/contracts";
import { createQueryClient } from "@/shared/api/query-client";
import { createMutationRequest } from "@/shared/api/mutation-request";
import { takePendingToast } from "@/shared/lib/pending-toast";
import {
  savePendingRequest,
  toPendingRequestRecord,
} from "@/shared/browser/pending-requests";

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

vi.mock("@/shared/lib/use-now", () => ({
  useNow: () => null,
}));

import { PaymentFormScreen } from "@/screens/payment-form/payment-form-screen";
import { PaymentDetailScreen } from "@/screens/payment-detail/payment-detail-screen";
import {
  burdensOf,
  CREATE_PAYMENT_OPERATION,
  paymentAmountFromInput,
  paymentCreateOf,
  slot0PercentOf,
  validatePaymentForm,
  type Participant,
  type PaymentFormValues,
} from "@/features/payments";

const userId = "550e8400-e29b-41d4-a716-446655440000";
const otherUserId = "3f7c1f68-9c05-4f2e-9b4c-2d5b1a90f811";
const tripId = "8a6e0804-2bd0-4672-b79d-d97027f9071a";
const planId = "6d6a86a1-6d0b-4c0f-9bb9-9a1d3a9e9c01";
const paymentId = "9a0b1c2d-3e4f-4a5b-9c6d-7e8f9a0b1c2d";

/** 参加者番号0はあおい、1はひなた（自分）。送る割合はあおいの負担の割合。 */
const meParticipant: Participant = {
  userId,
  slot: 1,
  displayName: "ひなた",
};
const otherParticipant: Participant = {
  userId: otherUserId,
  slot: 0,
  displayName: "あおい",
};
const participants = [otherParticipant, meParticipant] as const;

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

function balanceBody() {
  return {
    tripId,
    participants: [...participants],
    transfer: {
      signedTotalYen: "0",
      amountYen: "0",
      fromUserId: null,
      toUserId: null,
      requiresTransfer: false,
    },
    targetCount: 0,
    items: [],
    fetchedAt: "2026-09-27T12:00:00.000Z",
  };
}

function paymentResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: paymentId,
    tripId,
    planId: null,
    label: null,
    amountYen: "7001",
    payerUserId: userId,
    allocations: [
      { userId: otherUserId, percent: 50, burdenYen: "3500" },
      { userId, percent: 50, burdenYen: "3501" },
    ],
    createdBy: userId,
    createdAt: "2026-10-01T00:00:00.000Z",
    cancellation: null,
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

/** /api/meと /api/trips/* をURL・メソッドで振り分けるfake。 */
function stubApi(handlers: {
  me?: Handler;
  itinerary?: Handler;
  trip?: Handler;
  balance?: Handler;
  plan?: Handler;
  payment?: Handler;
  createPayment?: Handler;
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
          ? handlers.itinerary(init, url)
          : json(itineraryBody(trip(), [])),
      );
    }
    if (url === `/api/trips/${tripId}/balance` && method === "GET") {
      return Promise.resolve(
        handlers.balance !== undefined
          ? handlers.balance(init)
          : json(balanceBody()),
      );
    }
    if (url === `/api/trips/${tripId}/payments/${paymentId}` && method === "GET") {
      return Promise.resolve(
        handlers.payment !== undefined
          ? handlers.payment(init)
          : json(paymentResponse()),
      );
    }
    if (url === `/api/trips/${tripId}/payments` && method === "POST") {
      return Promise.resolve(
        handlers.createPayment !== undefined
          ? handlers.createPayment(init)
          : json(paymentResponse(), 201),
      );
    }
    if (url === `/api/trips/${tripId}/plans/${planId}` && method === "GET") {
      return Promise.resolve(
        handlers.plan !== undefined ? handlers.plan(init) : json(plan()),
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

function renderForm(
  planId: string | null = null,
  client = createQueryClient(),
) {
  render(
    <QueryClientProvider client={client}>
      <PaymentFormScreen tripId={tripId} planId={planId} />
    </QueryClientProvider>,
  );
  return client;
}

async function resetDb(): Promise<void> {
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase("tomotabi");
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

/** フォームが開くまで待つ（me・旅行・残額・保留の確認が全部済む）。 */
async function waitForForm() {
  const amountInput = await screen.findByLabelText("金額");
  // 払った人の選択肢は金額の欄より遅れて出ることがある（CIで落ちた）。
  await screen.findByRole("radio", { name: "ひなた（自分）" });
  return amountInput;
}

/** 保留中の要求を1件保存する。 */
async function seedPending(body: unknown) {
  const request = createMutationRequest({
    operation: CREATE_PAYMENT_OPERATION,
    url: `/api/trips/${tripId}/payments`,
    method: "POST",
    body,
  });
  const record = toPendingRequestRecord({ userId, tripId, request });
  await savePendingRequest(record);
  return record;
}

beforeEach(async () => {
  await resetDb();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  window.localStorage.clear();
  takePendingToast();
});

describe("送る割合の組み立て（FW-01）", () => {
  const meAsSlot0: Participant = { ...meParticipant, slot: 0 };
  const otherAsSlot1: Participant = { ...otherParticipant, slot: 1 };
  const flipped: readonly Participant[] = [meAsSlot0, otherAsSlot1];

  it("分け方と払った人の全組み合わせで参加者番号 0 の割合が正しい", () => {
    // 折半は常に50。
    expect(slot0PercentOf("half", meParticipant, meParticipant, 30)).toBe(50);
    expect(slot0PercentOf("half", otherParticipant, meParticipant, 30)).toBe(
      50,
    );
    // 払った人が全額: 払った人が0番なら100、1番なら0。
    expect(
      slot0PercentOf("payer-all", otherParticipant, meParticipant, 0),
    ).toBe(100);
    expect(slot0PercentOf("payer-all", meParticipant, meParticipant, 0)).toBe(
      0,
    );
    // もう一人が全額: 払った人が0番なら0、1番なら100。
    expect(
      slot0PercentOf("other-all", otherParticipant, meParticipant, 0),
    ).toBe(0);
    expect(slot0PercentOf("other-all", meParticipant, meParticipant, 0)).toBe(
      100,
    );
    // 割合を指定: 自分の割合をそのまま受け、払った人を切り替えても維持する。
    // （自分が0番 → 自分の値。自分が1番 → 100 − 自分の値。）
    expect(slot0PercentOf("ratio", meParticipant, meParticipant, 30)).toBe(70);
    expect(slot0PercentOf("ratio", otherParticipant, meParticipant, 30)).toBe(
      70,
    );
    expect(slot0PercentOf("ratio", meAsSlot0, meAsSlot0, 30)).toBe(30);
    expect(slot0PercentOf("ratio", otherAsSlot1, meAsSlot0, 30)).toBe(30);
    expect(flipped[0].slot).toBe(0);
  });

  it("paymentCreateOf は allocations を 0 番・1 番の順で合計 100 にし、label・planId は無いとき送らない", () => {
    const base: PaymentFormValues = {
      amount: "7001",
      payerUserId: userId,
      mode: "half",
      myPercent: "50",
      label: "  ",
      plan: null,
    };
    const body = paymentCreateOf(base, meParticipant, meParticipant, participants);
    expect(body).not.toBeNull();
    expect(body?.amountYen).toBe("7001");
    expect(body?.payerUserId).toBe(userId);
    expect(body?.allocations).toEqual([
      { userId: otherUserId, percent: 50 },
      { userId, percent: 50 },
    ]);
    expect(body).not.toHaveProperty("label");
    expect(body).not.toHaveProperty("planId");

    // 割合を指定 + 予定の関連付け + 用途。
    const withPlan = paymentCreateOf(
      {
        ...base,
        mode: "ratio",
        myPercent: "30",
        label: "昼食",
        plan: { id: planId, date: "2026-10-13", name: "錦市場で昼食" },
      },
      meParticipant,
      meParticipant,
      participants,
    );
    expect(withPlan?.allocations).toEqual([
      { userId: otherUserId, percent: 70 },
      { userId, percent: 30 },
    ]);
    expect(withPlan?.label).toBe("昼食");
    expect(withPlan?.planId).toBe(planId);
  });
});

describe("二人の負担と金額の検証（FW-02・FW-03）", () => {
  it("7,001 円・折半は払った人が 3,501 円・もう一人が 3,500 円", () => {
    // 払った人が1番（自分）: 0番のあおいが3,500。
    expect(burdensOf(7001n, 50, meParticipant)).toEqual({
      slot0: 3500n,
      slot1: 3501n,
    });
    // 払った人が0番（あおい）: あおいが3,501。
    expect(burdensOf(7001n, 50, otherParticipant)).toEqual({
      slot0: 3501n,
      slot1: 3500n,
    });
  });

  it("金額の入力は空・小数を拒否し、全角は半角に直し、3桁区切りのカンマは除く", () => {
    expect(paymentAmountFromInput("")).toBeNull();
    expect(paymentAmountFromInput("7,001")).toBe(7001n);
    expect(paymentAmountFromInput("7.5")).toBeNull();
    expect(paymentAmountFromInput("１０００")).toBe(1000n);
    expect(paymentAmountFromInput(" 7001 ")).toBe(7001n);
  });

  it("検証は空・0・10,000,000・数字以外を欄のエラーにし、カンマ付きは受ける", () => {
    const base: PaymentFormValues = {
      amount: "1",
      payerUserId: userId,
      mode: "half",
      myPercent: "50",
      label: "",
      plan: null,
    };
    expect(validatePaymentForm({ ...base, amount: "" }).amount).toBe(
      "金額を入力してください",
    );
    expect(validatePaymentForm({ ...base, amount: "7,001" }).amount).toBeUndefined();
    expect(validatePaymentForm({ ...base, amount: "7.5" }).amount).toBe(
      "数字だけで入力してください",
    );
    for (const amount of ["0", "10000000"]) {
      expect(validatePaymentForm({ ...base, amount }).amount).toBe(
        "1 円から 9,999,999 円までの金額にしてください",
      );
    }
    expect(
      validatePaymentForm({ ...base, mode: "ratio", myPercent: "101" })
        .myPercent,
    ).toBe("0 から 100 の整数で入力してください");
    expect(
      validatePaymentForm({ ...base, label: "あ".repeat(101) }).label,
    ).toBe("用途は 100 文字以内で入力してください");
  });
});

describe("PaymentFormScreen（v3 11・11b）", () => {
  it("開くと欄が出て、金額を入れると二人の負担を画面でも計算する（FW-02）", async () => {
    stubApi({});
    renderForm();
    const amountInput = await waitForForm();

    // 既定は自分が払った人・折半。
    expect(
      screen.getByRole("radio", { name: "ひなた（自分）" }),
    ).toBeChecked();
    expect(screen.getByRole("radio", { name: "折半" })).toBeChecked();

    await userEvent.type(amountInput, "7001");
    // 払った人（自分・1番）が3,501、あおい（0番）が3,500。
    const rows = screen.getAllByText(/3,50[01] 円/);
    expect(rows).toHaveLength(2);
    expect(screen.getByText("3,500 円")).toBeInTheDocument();
    expect(screen.getByText("3,501 円")).toBeInTheDocument();
    // #247: 端数の寄り方を、結果を見る前に例の数字で読めるように、負担の欄の上に出す。
    const note = screen.getByText(/割り切れない 1 円は払った人の負担になります/);
    expect(note).toHaveTextContent("3,001 円を折半すると、払った人が 1,501 円、もう一人が 1,500 円");
    const share = document.querySelector(".pay-share");
    expect(
      share !== null &&
        (note.compareDocumentPosition(share) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
    ).toBe(true);
  });

  it("金額や割合がまだ無い欄は、横線ではなく「未入力」と出す（#247）", async () => {
    stubApi({});
    renderForm();
    await waitForForm();
    const user = userEvent.setup();
    expect(screen.getAllByText("未入力", { selector: ".pay-share-yen" })).toHaveLength(2);
    await user.click(screen.getByRole("radio", { name: "割合を指定" }));
    expect(screen.getByText(/もう一人は残りの割合になります/)).toBeInTheDocument();
    await user.clear(await screen.findByLabelText("自分の負担の割合"));
    expect(screen.getByText("未入力", { selector: ".pay-share-percent" })).toBeInTheDocument();
    expect(screen.queryByText("—")).not.toBeInTheDocument();
  });

  it("二人の負担は払った人の名前の下に小さく「払った人」を出し、名前横の札は出さない", async () => {
    stubApi({});
    renderForm();
    const amountInput = await waitForForm();
    const user = userEvent.setup();
    await user.type(amountInput, "7001");

    const shareRowOf = (name: string) =>
      screen
        .getByText(name, { selector: ".pay-share-name" })
        .closest(".pay-share-row");

    // 既定は自分が払った人 → 自分の行の名前の下に「払った人」。
    const myRow = shareRowOf("ひなた");
    expect(
      myRow?.querySelector(".pay-share-sub")?.textContent,
    ).toBe("払った人");
    // 払っていない相手の行には下の小さな文字を出さない。
    expect(
      shareRowOf("あおい")?.querySelector(".pay-share-sub"),
    ).toBeNull();

    // 払った人をあおいに変える → あおいが「払った人」、自分は「自分」。
    await user.click(screen.getByRole("radio", { name: "あおい" }));
    expect(
      shareRowOf("あおい")?.querySelector(".pay-share-sub")?.textContent,
    ).toBe("払った人");
    expect(
      shareRowOf("ひなた")?.querySelector(".pay-share-sub")?.textContent,
    ).toBe("自分");

    // 名前の横の札（pill）は出さない。
    expect(document.querySelector(".pay-share-tag")).toBeNull();
  });

  it("金額は打ったそばから3桁で区切る（2026-10-19 ユーザーの判断）", async () => {
    stubApi({});
    renderForm();
    const amountInput = await waitForForm();
    const user = userEvent.setup();

    await user.type(amountInput, "1234567");
    expect(amountInput).toHaveValue("1,234,567");
  });

  it("途中に打っても、入力位置は打った数字の直後に残る", async () => {
    stubApi({});
    renderForm();
    const amountInput = (await waitForForm()) as HTMLInputElement;
    const user = userEvent.setup();

    await user.type(amountInput, "1200");
    // 「1,2|00」の位置に「5」を打つ → 「12,5|00」
    amountInput.setSelectionRange(3, 3);
    await user.keyboard("5");
    expect(amountInput).toHaveValue("12,500");
    expect(amountInput.selectionStart).toBe(4);
  });

  it("FW-03: 数字以外・0・10,000,000 は欄のエラーになり送らない", async () => {
    const fetchMock = stubApi({});
    renderForm();
    const amountInput = await waitForForm();
    const user = userEvent.setup();

    await user.type(amountInput, "7.5");
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(
      await screen.findByText("数字だけで入力してください"),
    ).toBeInTheDocument();
    expect(writeCalls(fetchMock)).toHaveLength(0);

    await user.clear(amountInput);
    await user.type(amountInput, "10000000");
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(
      await screen.findByText(
        "1 円から 9,999,999 円までの金額にしてください",
      ),
    ).toBeInTheDocument();
    expect(writeCalls(fetchMock)).toHaveLength(0);
  });

  it("保存は POST /payments に割合を送り、残額・確認の一覧・確認の詳細を取り直す（FW-12）", async () => {
    const client = createQueryClient();
    // 開いている確認の詳細・確認の一覧がキャッシュにある状態で保存する。
    client.setQueryData(["settlement-previews", tripId], { stale: true });
    client.setQueryData(["settlement-preview", tripId, "preview-1"], {
      stale: true,
    });
    const fetchMock = stubApi({
      createPayment: () => json(paymentResponse(), 201),
    });
    renderForm(null, client);
    const amountInput = await waitForForm();
    const user = userEvent.setup();

    await user.type(amountInput, "7001");
    await user.type(screen.getByLabelText(/用途/), "昼食");
    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(replaceMock).toHaveBeenCalledWith(`/trips/${tripId}/itinerary`),
    );

    const calls = writeCalls(fetchMock);
    expect(calls).toHaveLength(1);
    const [url, init] = calls[0];
    expect(url).toBe(`/api/trips/${tripId}/payments`);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      amountYen: "7001",
      payerUserId: userId,
      allocations: [
        { userId: otherUserId, percent: 50 },
        { userId, percent: 50 },
      ],
      label: "昼食",
    });
    expect(new Headers(init?.headers).get("idempotency-key")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );

    // FW-12: 残額・確認の一覧・確認の詳細を取り直す。
    // 残額は画面が保持しているので無効化→再取得（2回目のGET）で確かめる。
    expect(
      client.getQueryState(["settlement-previews", tripId])?.isInvalidated,
    ).toBe(true);
    expect(
      client.getQueryState(["settlement-preview", tripId, "preview-1"])
        ?.isInvalidated,
    ).toBe(true);
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(
          ([callUrl]) => String(callUrl) === `/api/trips/${tripId}/balance`,
        ).length,
      ).toBeGreaterThanOrEqual(2),
    );
    expect(takePendingToast()).toBe("支払いを記録しました");
  });

  it("分け方を割合を指定にして払った人を切り替えても各人の割合を保つ（FW-01）", async () => {
    const fetchMock = stubApi({});
    renderForm();
    const amountInput = await waitForForm();
    const user = userEvent.setup();

    await user.type(amountInput, "1000");
    await user.click(screen.getByRole("radio", { name: "割合を指定" }));
    const percentInput = await screen.findByLabelText("自分の負担の割合");
    await user.clear(percentInput);
    await user.type(percentInput, "30");
    await user.click(screen.getByRole("radio", { name: "あおい" }));
    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(writeCalls(fetchMock)).toHaveLength(1));
    const [, init] = writeCalls(fetchMock)[0];
    // 自分（1番）の30% → あおい（0番）は70。払った人はあおい。
    expect(JSON.parse(String(init?.body))).toEqual({
      amountYen: "1000",
      payerUserId: otherUserId,
      allocations: [
        { userId: otherUserId, percent: 70 },
        { userId, percent: 30 },
      ],
    });
  });

  it("FW-04: 予定の詳細から開くと、その予定を getPlan で確かめて選んだ状態になる", async () => {
    const fetchMock = stubApi({
      // しおりの表示日（既定）と違う日の予定でも選んだ状態にする。
      plan: () => json(plan({ date: "2026-10-14" })),
    });
    renderForm(planId);
    const amountInput = await waitForForm();
    const user = userEvent.setup();

    expect(
      await screen.findByText(/錦市場で昼食/),
    ).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(
        ([url]) =>
          String(url) === `/api/trips/${tripId}/plans/${planId}` &&
          true,
      ),
    ).toBe(true);

    await user.type(amountInput, "500");
    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(writeCalls(fetchMock)).toHaveLength(1));
    const [, init] = writeCalls(fetchMock)[0];
    expect(JSON.parse(String(init?.body)).planId).toBe(planId);
  });

  it("関連する予定は選び直しシートで選べる（しおりの表示日と違う日も）", async () => {
    const fetchMock = stubApi({
      itinerary: (_init, url) =>
        // 下のしおり（既定日）は空、選び直した日（10/13）にだけ予定を返す。
        url?.includes("date=2026-10-13") === true
          ? json(itineraryBody(trip(), [plan()], "2026-10-13"))
          : json(itineraryBody(trip(), [])),
    });
    renderForm();
    await waitForForm();
    const user = userEvent.setup();

    await user.click(
      screen.getByRole("button", { name: /選択しない/ }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "関連する予定",
    });
    // 日を10/13に変えるとその日の予定が並ぶ。
    await user.click(
      within(dialog).getByRole("radio", { name: "10/13(火)" }),
    );
    await user.click(
      await within(dialog).findByRole("radio", { name: /錦市場で昼食/ }),
    );
    await user.click(
      within(dialog).getByRole("button", { name: "この予定にする" }),
    );
    expect(await screen.findByText(/錦市場で昼食/)).toBeInTheDocument();
    // 予定の日のgetItineraryが投げられている。
    expect(
      fetchMock.mock.calls.some(([callUrl]) =>
        String(callUrl).includes(`itinerary?date=2026-10-13`),
      ),
    ).toBe(true);
  });

  it("URL の予定が確かめられないときは再取得と解除だけを出す（自動では関連なしにしない）", async () => {
    const fetchMock = stubApi({
      plan: () => notFound(),
    });
    renderForm(planId);
    await waitFor(() =>
      expect(
        screen.getByText("関連する予定を確認できませんでした"),
      ).toBeInTheDocument(),
    );
    // 文言（getByText）は見えているかに関係なく当たるが、ボタン（getByRole）は
    // シートが開ききって見える状態になるまで当たらない。重いときはその差で
    // 落ちていたので、ボタンも見える状態になるまで待つ。
    expect(
      await screen.findByRole("button", { name: "再取得する" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "関連付けを解除する" }),
    ).toBeInTheDocument();
    void fetchMock;
  });

  it("予定の詳細から開いたときは、保存したあとその予定の詳細へ移る", async () => {
    const fetchMock = stubApi({});
    renderForm(planId);
    const amountInput = await waitForForm();
    const user = userEvent.setup();
    // URLのplanIdを確かめて選んだ状態になるまで待つ。
    await screen.findByText(/錦市場で昼食/);

    await user.type(amountInput, "500");
    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(replaceMock).toHaveBeenCalledWith(
        `/trips/${tripId}/plans/${planId}`,
      ),
    );
    expect(writeCalls(fetchMock)).toHaveLength(1);
  });

  it("予定の詳細から開いたときは、戻るリンクもその予定の詳細へ", async () => {
    stubApi({});
    renderForm(planId);
    await waitForForm();
    await screen.findByText(/錦市場で昼食/);

    await userEvent.click(
      screen.getByRole("button", { name: "閉じる" }),
    );
    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith(
        `/trips/${tripId}/plans/${planId}`,
      ),
    );
  });

  it("訂正元とURLの予定が違うとき、戻るリンクはしおりへ", async () => {
    // 訂正元（from）の支払いは予定と結びついていないので、URLの
    // planIdは確かめられない（確かめたのは別の予定でないため）。
    stubApi({ payment: () => json(paymentResponse({ planId: null })) });
    render(
      <QueryClientProvider client={createQueryClient()}>
        <PaymentFormScreen
          tripId={tripId}
          planId={planId}
          fromPaymentId={paymentId}
        />
      </QueryClientProvider>,
    );
    await waitForForm();

    await userEvent.click(
      screen.getByRole("button", { name: "閉じる" }),
    );
    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith(`/trips/${tripId}/itinerary`),
    );
  });

  it("URL の予定が確かめられないとき、戻るリンクはしおりへ", async () => {
    stubApi({ plan: () => notFound() });
    renderForm(planId);
    await screen.findByRole("button", { name: "再取得する" });

    await userEvent.click(
      screen.getByRole("button", { name: "閉じる" }),
    );
    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith(`/trips/${tripId}/itinerary`),
    );
  });

  it("予定の詳細から開いた保留を確認したあとも、その予定の詳細へ移る", async () => {
    await seedPending({
      amountYen: "500",
      payerUserId: userId,
      allocations: [
        { userId: otherUserId, percent: 50 },
        { userId, percent: 50 },
      ],
      planId,
    });
    const fetchMock = stubApi({});
    renderForm(planId);

    await screen.findByText("保存されたか確認できません");
    await userEvent.click(
      screen.getByRole("button", { name: "同じ内容で確認する" }),
    );
    await waitFor(() => expect(writeCalls(fetchMock)).toHaveLength(1));
    await waitFor(() =>
      expect(replaceMock).toHaveBeenCalledWith(
        `/trips/${tripId}/plans/${planId}`,
      ),
    );
  });

  it("同じ利用者・旅行・操作の保留があれば入力を固定して確認の操作だけ出す（FW-09）", async () => {
    const record = await seedPending({
      amountYen: "7001",
      payerUserId: userId,
      allocations: [
        { userId: otherUserId, percent: 50 },
        { userId, percent: 50 },
      ],
      label: "昼食",
    });
    const fetchMock = stubApi({});
    renderForm();

    // 入力は固定され、保存（新しいキー）のボタンは出ない。
    await screen.findByText("保存されたか確認できません");
    const amountInput = screen.getByLabelText("金額");
    expect(amountInput).toHaveAttribute("readonly");
    expect(amountInput).toHaveValue("7,001");
    // シートの<dialog>はuseEffectで開くため、役割で探すものはfindで待つ。
    expect(
      await screen.findByRole("radio", { name: "折半" }),
    ).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "保存" }),
    ).not.toBeInTheDocument();

    // 「同じ内容で確認する」は保存済みの要求をそのまま送る。
    await userEvent.click(
      screen.getByRole("button", { name: "同じ内容で確認する" }),
    );
    await waitFor(() => expect(writeCalls(fetchMock)).toHaveLength(1));
    const [url, init] = writeCalls(fetchMock)[0];
    expect(url).toBe(`/api/trips/${tripId}/payments`);
    expect(new Headers(init?.headers).get("idempotency-key")).toBe(
      record.idempotencyKey,
    );
    expect(JSON.parse(String(init?.body)).amountYen).toBe("7001");
    await waitFor(() =>
      expect(replaceMock).toHaveBeenCalledWith(`/trips/${tripId}/itinerary`),
    );
  });

  it("送る前の保存が失敗したら送らずに止めて案内を出す（FW-08）", async () => {
    const fetchMock = stubApi({});
    renderForm();
    const amountInput = await waitForForm();
    const user = userEvent.setup();
    await user.type(amountInput, "7001");

    const putSpy = vi
      .spyOn(IDBObjectStore.prototype, "put")
      .mockImplementation(() => {
        throw new DOMException("writes blocked", "InvalidStateError");
      });
    try {
      await user.click(screen.getByRole("button", { name: "保存" }));
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

describe("支払いの詳細の相手の印（#300）", () => {
  it("払った人と負担の内訳で、相手の名前にだけ（相手）を付ける", async () => {
    stubApi({
      payment: () =>
        json(
          paymentResponse({
            payerUserId: otherUserId,
            createdBy: otherUserId,
          }),
        ),
    });
    render(
      <QueryClientProvider client={createQueryClient()}>
        <PaymentDetailScreen tripId={tripId} paymentId={paymentId} />
      </QueryClientProvider>,
    );

    // 払った人は相手（あおい）→（相手）が付く。
    const payerRow = (await screen.findByText("払った人")).closest(
      ".payment-detail-row",
    )!;
    expect(payerRow).toHaveTextContent("あおい（相手）");

    // 負担の内訳は、相手にだけ付き自分（ひなた）には付かない。
    const sharesRow = screen
      .getByText("二人の負担")
      .closest(".payment-detail-row")!;
    expect(sharesRow).toHaveTextContent("あおい（相手） 50% · 3,500");
    expect(sharesRow).toHaveTextContent("ひなた 50% · 3,501");
    expect(sharesRow).not.toHaveTextContent("ひなた（相手）");

    // 名前が1つだけ出る「記録」の行は変えない。
    const recordRow = screen
      .getByText("記録", { selector: "dt" })
      .closest(".payment-detail-row")!;
    expect(recordRow).toHaveTextContent(/あおい が /);
    expect(recordRow).not.toHaveTextContent("（相手）");
  });

  it("表示名が空の相手は「相手」とだけ出し、「相手（相手）」にしない", async () => {
    stubApi({
      payment: () =>
        json(
          paymentResponse({
            payerUserId: otherUserId,
            createdBy: otherUserId,
          }),
        ),
      balance: () =>
        json({
          ...balanceBody(),
          participants: [
            { ...meParticipant },
            { ...otherParticipant, displayName: "" },
          ],
        }),
    });
    render(
      <QueryClientProvider client={createQueryClient()}>
        <PaymentDetailScreen tripId={tripId} paymentId={paymentId} />
      </QueryClientProvider>,
    );

    const payerRow = (await screen.findByText("払った人")).closest(
      ".payment-detail-row",
    )!;
    // 名前が取れないので「相手」とだけ出る。印は付けない。
    expect(payerRow).toHaveTextContent("相手");
    expect(payerRow).not.toHaveTextContent("（相手）");
    expect(screen.queryByText("（相手）")).not.toBeInTheDocument();
  });
});
