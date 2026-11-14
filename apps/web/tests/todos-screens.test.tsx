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
import type { Todo, TodoCategory, TodoList, Trip } from "@tomotabi/contracts";
import { deleteTodoDraft, updateTodoDraft } from "@/features/todos";
import { createMutationRequest } from "@/shared/api/mutation-request";
import { createQueryClient } from "@/shared/api/query-client";
import {
  savePendingRequest,
  toPendingRequestRecord,
} from "@/shared/browser/pending-requests";

const { pushMock, replaceMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  replaceMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, push: pushMock, back: vi.fn() }),
}));

vi.mock("@/shared/auth/auth-client", () => ({
  authClient: { signOut: vi.fn() },
}));

import { TodosScreen } from "@/screens/todos/todos-screen";
import { TodoDetailScreen } from "@/screens/todo-detail/todo-detail-screen";
import { PlanFormScreen } from "@/screens/plan-form/plan-form-screen";

const userId = "550e8400-e29b-41d4-a716-446655440000";
const otherUserId = "3f7c1f68-9c05-4f2e-9b4c-2d5b1a90f811";
const tripId = "8a6e0804-2bd0-4672-b79d-d97027f9071a";
const todoId = "5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a51";
const planId = "6d6a86a1-6d0b-4c0f-9bb9-9a1d3a9e9c01";

const meBody = {
  user: { id: userId, displayName: "ひなた" },
  sessionExpiresAt: "2026-10-03T07:43:00.000Z",
};

function trip(): Trip {
  return {
    id: tripId,
    name: "秋の京都",
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

const categoryA = "aaaaaaa1-1111-4111-8111-111111111111";
const categoryB = "bbbbbbb2-2222-4222-8222-222222222222";
const categoryC = "ccccccc3-3333-4333-8333-333333333333";

function cat(id: string, name: string, version = "1"): TodoCategory {
  return { id, tripId, name, version };
}

function todo(overrides: Partial<Todo> = {}): Todo {
  return {
    id: todoId,
    tripId,
    name: "湯豆腐を食べる",
    memo: null,
    createdBy: otherUserId,
    createdAt: "2026-11-08T03:00:00.000Z",
    doneAt: null,
    doneBy: null,
    plan: null,
    categoryId: null,
    assigneeId: null,
    dueOn: null,
    version: "1",
    ...overrides,
  };
}

function balanceBody() {
  return {
    tripId,
    participants: [
      { userId, slot: 0, displayName: "ひなた" },
      { userId: otherUserId, slot: 1, displayName: "みお" },
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

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function urlOf(input: RequestInfo | URL): string {
  return typeof input === "string"
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;
}

type Handler = (init?: RequestInit) => Response | Promise<Response>;

/** /api/me・旅行・残額・ToDo・カテゴリ・予定の追加をURLとメソッドで振り分けるfake。 */
function stubApi(handlers: {
  todos?: () => Todo[] | TodoList | Response;
  create?: Handler;
  complete?: Handler;
  update?: Handler;
  remove?: Handler;
  createPlan?: Handler;
  createCategory?: Handler;
  updateCategory?: Handler;
  reorderCategories?: Handler;
  deleteCategory?: Handler;
}): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = urlOf(input);
    const method = init?.method ?? "GET";
    const base = `/api/trips/${tripId}`;
    if (url === "/api/me") {
      return Promise.resolve(json(meBody));
    }
    if (url === base && method === "GET") {
      return Promise.resolve(json(trip()));
    }
    if (url === `${base}/balance`) {
      return Promise.resolve(json(balanceBody()));
    }
    if (url === `${base}/todos` && method === "GET") {
      const result = handlers.todos?.() ?? { categories: [], items: [] };
      return Promise.resolve(
        result instanceof Response
          ? result
          : Array.isArray(result)
            ? json({ categories: [], items: result })
            : json(result),
      );
    }
    if (url === `${base}/todo-categories` && method === "POST") {
      return Promise.resolve(
        handlers.createCategory?.(init) ??
          json(cat(categoryA, "洗濯物"), 201),
      );
    }
    if (url === `${base}/todo-categories/order` && method === "PUT") {
      return Promise.resolve(
        handlers.reorderCategories?.(init) ?? json({ categories: [] }),
      );
    }
    if (
      new RegExp(`^${base}/todo-categories/[^/]+/delete$`).test(url) &&
      method === "POST"
    ) {
      const id = url.split("/").at(-2) ?? categoryA;
      return Promise.resolve(
        handlers.deleteCategory?.(init) ??
          json({ id, deletedTodoCount: 0 }),
      );
    }
    if (
      new RegExp(`^${base}/todo-categories/[^/]+$`).test(url) &&
      method === "PATCH"
    ) {
      const id = url.split("/").at(-1) ?? categoryA;
      return Promise.resolve(
        handlers.updateCategory?.(init) ??
          json({ id, tripId, name: "名前", version: "2" }),
      );
    }
    if (url === `${base}/todos` && method === "POST") {
      return Promise.resolve(handlers.create?.(init) ?? json(todo(), 201));
    }
    if (url === `${base}/todos/${todoId}/complete`) {
      return Promise.resolve(handlers.complete?.(init) ?? json(todo()));
    }
    if (url === `${base}/todos/${todoId}` && method === "PATCH") {
      return Promise.resolve(handlers.update?.(init) ?? json(todo()));
    }
    if (url === `${base}/todos/${todoId}/delete`) {
      return Promise.resolve(handlers.remove?.(init) ?? json({ id: todoId }));
    }
    if (url === `${base}/plans` && method === "POST") {
      return Promise.resolve(handlers.createPlan?.(init) ?? json({}, 201));
    }
    return Promise.resolve(json({ code: "NOT_FOUND" }, 404));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function callsTo(
  fetchMock: ReturnType<typeof vi.fn>,
  path: string,
  method: string,
) {
  return fetchMock.mock.calls.filter(
    ([input, init]) =>
      urlOf(input as RequestInfo) === path &&
      ((init as RequestInit | undefined)?.method ?? "GET") === method,
  );
}

function renderScreen(ui: React.ReactElement) {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      {ui}
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

async function saveDeletePending(targetTodoId: string): Promise<void> {
  const request = createMutationRequest(
    deleteTodoDraft(tripId, targetTodoId),
  );
  await savePendingRequest(
    toPendingRequestRecord({ userId, tripId, request }),
  );
}

async function saveUpdatePending(targetTodoId: string): Promise<void> {
  const request = createMutationRequest(
    updateTodoDraft(tripId, targetTodoId, { name: "残るToDo" }, "1"),
  );
  await savePendingRequest(
    toPendingRequestRecord({ userId, tripId, request }),
  );
}

beforeEach(async () => {
  localStorage.clear();
  await resetDb();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("ToDoのリスト", () => {
  it("0件なら「ToDoはまだありません」と追加の説明を出す（B-01）", async () => {
    stubApi({ todos: () => [] });
    renderScreen(<TodosScreen tripId={tripId} />);
    expect(await screen.findByText("ToDoはまだありません")).toBeInTheDocument();
    expect(screen.getByText(/「追加する」を押すと/)).toBeInTheDocument();
  });

  it("カテゴリが無ければ見出しは出さず、ToDoと「カテゴリを追加」を並べる（W-S01・B-01）", async () => {
    stubApi({
      todos: () => [
        todo({
          id: "a1111111-1111-4111-8111-111111111111",
          name: "清水寺",
          createdBy: userId,
        }),
        todo({
          id: "a2222222-2222-4222-8222-222222222222",
          name: "両替する",
          memo: "空港で",
        }),
        todo({
          id: "a3333333-3333-4333-8333-333333333333",
          name: "錦市場",
          doneAt: "2026-11-08T05:00:00.000Z",
          doneBy: userId,
          plan: {
            id: planId,
            name: "錦市場",
            date: "2026-10-13",
            cancelled: false,
          },
        }),
        todo({
          id: "a4444444-4444-4444-8444-444444444444",
          name: "新幹線を予約する",
          doneAt: "2026-11-08T05:00:00.000Z",
          doneBy: otherUserId,
          plan: {
            id: planId,
            name: "新幹線を予約する",
            date: "2026-10-13",
            cancelled: true,
          },
        }),
      ],
    });
    renderScreen(<TodosScreen tripId={tripId} />);
    expect(await screen.findByText("清水寺")).toBeInTheDocument();
    // カテゴリが0個なら欄の見出しを出さない（B-04）。
    expect(screen.queryByRole("region", { name: "未分類" })).toBeNull();
    expect(screen.getByText("あなたが追加した")).toBeInTheDocument();
    expect(screen.getByText("みおが追加した · メモあり")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "10/13 錦市場 ›" }),
    ).toHaveAttribute("href", `/trips/${tripId}/plans/${planId}`);
    expect(
      screen.getByRole("link", { name: "取りやめた予定 ›" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/みおが予定にした/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "カテゴリを追加" }),
    ).toBeInTheDocument();
  });

  it("カテゴリの欄を二人の順で出し、見出しに「1 / 3 件済み」。最後に未分類（W-S02・F-03〜F-05）", async () => {
    stubApi({
      todos: () => ({
        categories: [cat(categoryA, "洗濯物"), cat(categoryB, "予約")],
        items: [
          todo({
            id: "a1111111-1111-4111-8111-111111111111",
            name: "下着を洗う",
            categoryId: categoryA,
          }),
          todo({
            id: "a2222222-2222-4222-8222-222222222222",
            name: "靴下を洗う",
            categoryId: categoryA,
            doneAt: "2026-11-08T05:00:00.000Z",
            doneBy: userId,
          }),
          todo({
            id: "a3333333-3333-4333-8333-333333333333",
            name: "列車を予約",
            categoryId: categoryB,
          }),
          todo({ id: "a4444444-4444-4444-8444-444444444444", name: "任意" }),
        ],
      }),
    });
    renderScreen(<TodosScreen tripId={tripId} />);
    const regionA = await screen.findByRole("region", { name: "洗濯物" });
    const regionB = screen.getByRole("region", { name: "予約" });
    const regionU = screen.getByRole("region", { name: "未分類" });
    // 欄はカテゴリの順で未分類が最後。
    expect(
      regionA.compareDocumentPosition(regionB) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      regionB.compareDocumentPosition(regionU) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // 見出しに「1 / 3 件済み」（洗濯物は2件で1件済み）
    expect(
      within(regionA).getByRole("button", { name: /^洗濯物/ }),
    ).toHaveTextContent("1 / 2 件済み");
    // 欄の中は未完了が上
    const names = within(regionA)
      .getAllByRole("link")
      .map((link) => link.textContent);
    expect(names).toEqual(["下着を洗う", "靴下を洗う"]);
    // 進み具合
    expect(screen.getByText("1件済み · 残り3件")).toBeInTheDocument();
  });

  it("一行で書いて「追加する」で送り、送ったら欄を空にする（F-05）", async () => {
    const fetchMock = stubApi({ todos: () => [] });
    renderScreen(<TodosScreen tripId={tripId} />);
    const input = await screen.findByLabelText("ToDoの内容");
    const button = screen.getByRole("button", { name: "追加する" });
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.type(input, "  清水寺  ");
    await userEvent.click(button);
    await waitFor(() =>
      expect(
        callsTo(fetchMock, `/api/trips/${tripId}/todos`, "POST"),
      ).toHaveLength(1),
    );
    const [, init] = callsTo(
      fetchMock,
      `/api/trips/${tripId}/todos`,
      "POST",
    )[0]!;
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      name: "清水寺",
    });
    await waitFor(() => expect(input).toHaveValue(""));
  });

  it("空のまま「追加する」を押しても送らない（E-01）", async () => {
    const fetchMock = stubApi({ todos: () => [] });
    renderScreen(<TodosScreen tripId={tripId} />);
    const button = await screen.findByRole("button", { name: "追加する" });
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.click(button);
    expect(screen.getByText("ToDoの内容を書いてください")).toBeInTheDocument();
    expect(
      callsTo(fetchMock, `/api/trips/${tripId}/todos`, "POST"),
    ).toHaveLength(0);
  });

  it("200件あると上限の理由を出す（E-02）", async () => {
    stubApi({
      todos: () => [],
      create: () => json({ code: "TODO_LIMIT_REACHED", message: "x" }, 422),
    });
    renderScreen(<TodosScreen tripId={tripId} />);
    const button = await screen.findByRole("button", { name: "追加する" });
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.type(screen.getByLabelText("ToDoの内容"), "201件目");
    await userEvent.click(button);
    expect(await screen.findByText(/200件までです/)).toBeInTheDocument();
  });

  it("完了の印を押すと版なしで送り、すぐ済んだ欄に移す（F-07）", async () => {
    let items = [todo()];
    const fetchMock = stubApi({
      todos: () => items,
      complete: () => {
        items = [
          todo({
            doneAt: "2026-11-08T05:00:00.000Z",
            doneBy: userId,
            version: "2",
          }),
        ];
        return json(items[0]);
      },
    });
    renderScreen(<TodosScreen tripId={tripId} />);
    await userEvent.click(
      await screen.findByRole("button", {
        name: "「湯豆腐を食べる」を完了にする",
      }),
    );
    expect(
      await screen.findByRole("button", {
        name: "「湯豆腐を食べる」を未完了に戻す",
      }),
    ).toBeInTheDocument();
    const completePath = `/api/trips/${tripId}/todos/${todoId}/complete`;
    await waitFor(() =>
      expect(callsTo(fetchMock, completePath, "POST")).toHaveLength(1),
    );
    const [, init] = callsTo(fetchMock, completePath, "POST")[0]!;
    expect(
      new Headers((init as RequestInit).headers).has("X-Expected-Version"),
    ).toBe(false);
  });

  it("相手が消したToDoに印を押すと、リストに留まって読み直す（E-04）", async () => {
    let items = [todo()];
    const fetchMock = stubApi({
      todos: () => items,
      complete: () => {
        items = [];
        return json({ code: "TODO_NOT_FOUND", message: "x" }, 404);
      },
    });
    renderScreen(<TodosScreen tripId={tripId} />);
    await userEvent.click(
      await screen.findByRole("button", {
        name: "「湯豆腐を食べる」を完了にする",
      }),
    );
    expect(
      await screen.findByText(/このToDoは相手が削除しました/),
    ).toBeInTheDocument();
    expect(await screen.findByText("ToDoはまだありません")).toBeInTheDocument();
    expect(screen.queryByText("旅行を開けません")).toBeNull();
    expect(
      callsTo(fetchMock, `/api/trips/${tripId}/todos`, "GET").length,
    ).toBeGreaterThan(1);
  });

  it("オフラインなら追加する・完了の印を押せない（E-09）", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    stubApi({ todos: () => [todo()] });
    renderScreen(<TodosScreen tripId={tripId} />);
    expect(
      await screen.findByRole("button", {
        name: "「湯豆腐を食べる」を完了にする",
      }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "追加する" })).toBeDisabled();
  });

  it("欄をたたむと行が隠れ、端末に覚える（W-S03・F-07）", async () => {
    stubApi({
      todos: () => ({
        categories: [cat(categoryA, "洗濯物")],
        items: [todo({ categoryId: categoryA })],
      }),
    });
    renderScreen(<TodosScreen tripId={tripId} />);
    const toggle = await screen.findByRole("button", { name: /^洗濯物/ });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("湯豆腐を食べる")).toBeInTheDocument();
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("湯豆腐を食べる")).toBeNull();
    // 端末に覚える（旅行ごとのキー）。
    expect(localStorage.getItem(`tomotabi:todos-collapsed:${tripId}`)).toBe(
      JSON.stringify([categoryA]),
    );
    await userEvent.click(toggle);
    expect(screen.getByText("湯豆腐を食べる")).toBeInTheDocument();
    expect(localStorage.getItem(`tomotabi:todos-collapsed:${tripId}`)).toBe(
      "[]",
    );
  });

  it("「自分の担当」に当てはまるものが無ければ「当てはまるToDoはありません」（W-S04・B-07）", async () => {
    stubApi({
      todos: () => ({
        categories: [cat(categoryA, "洗濯物")],
        items: [todo({ categoryId: categoryA, assigneeId: otherUserId })],
      }),
    });
    renderScreen(<TodosScreen tripId={tripId} />);
    await screen.findByRole("region", { name: "洗濯物" });
    await userEvent.click(
      screen.getByRole("button", { name: "自分の担当" }),
    );
    expect(
      await screen.findByText("当てはまるToDoはありません"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "洗濯物" })).toBeNull();
  });

  it("追加の欄で選んだカテゴリを送る本文に入れる（W-S05・F-08）", async () => {
    const fetchMock = stubApi({
      todos: () => ({
        categories: [cat(categoryA, "洗濯物")],
        items: [],
      }),
    });
    renderScreen(<TodosScreen tripId={tripId} />);
    const select = await screen.findByLabelText("入れるカテゴリ");
    await userEvent.selectOptions(select, categoryA);
    await userEvent.type(screen.getByLabelText("ToDoの内容"), "靴下");
    await userEvent.click(screen.getByRole("button", { name: "追加する" }));
    await waitFor(() =>
      expect(
        callsTo(fetchMock, `/api/trips/${tripId}/todos`, "POST"),
      ).toHaveLength(1),
    );
    const [, init] = callsTo(
      fetchMock,
      `/api/trips/${tripId}/todos`,
      "POST",
    )[0]!;
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      name: "靴下",
      categoryId: categoryA,
    });
    // 最後に選んだカテゴリを端末に覚える。
    expect(
      localStorage.getItem(`tomotabi:todos-add-category:${tripId}`),
    ).toBe(categoryA);
  });

  it("削除の確かめに名前と「ToDo 3件も削除されます」。押すとexpectedTodoCountを送る（W-S06・B-04）", async () => {
    const fetchMock = stubApi({
      todos: () => ({
        categories: [cat(categoryA, "洗濯物")],
        items: [
          todo({ id: "a1111111-1111-4111-8111-111111111111", categoryId: categoryA }),
          todo({ id: "a2222222-2222-4222-8222-222222222222", categoryId: categoryA }),
          todo({ id: "a3333333-3333-4333-8333-333333333333", categoryId: categoryA }),
        ],
      }),
    });
    renderScreen(<TodosScreen tripId={tripId} />);
    await userEvent.click(
      await screen.findByRole("button", { name: "「洗濯物」のメニュー" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "削除" }),
    );
    const sheet = await screen.findByRole("dialog", {
      name: "カテゴリを削除",
    });
    expect(within(sheet).getByText(/「洗濯物」/)).toBeInTheDocument();
    expect(
      within(sheet).getByText(/ToDo 3件も削除されます/),
    ).toBeInTheDocument();
    const deleteButton = within(sheet).getByRole("button", {
      name: "削除する",
    });
    await waitFor(() => expect(deleteButton).toBeEnabled());
    await userEvent.click(deleteButton);
    const path = `/api/trips/${tripId}/todo-categories/${categoryA}/delete`;
    await waitFor(() =>
      expect(callsTo(fetchMock, path, "POST")).toHaveLength(1),
    );
    const [, init] = callsTo(fetchMock, path, "POST")[0]!;
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      expectedTodoCount: 3,
    });
  });

  it("件数が変わって削除できないときは、件数が変わったことを出して読み直す（W-S07・E-05）", async () => {
    let removed = false;
    const fetchMock = stubApi({
      todos: () => ({
        categories: removed ? [] : [cat(categoryA, "洗濯物")],
        items: removed
          ? []
          : [todo({ categoryId: categoryA })],
      }),
      deleteCategory: () => {
        removed = true;
        return json({ code: "TODO_COUNT_CHANGED", message: "x" }, 409);
      },
    });
    renderScreen(<TodosScreen tripId={tripId} />);
    await userEvent.click(
      await screen.findByRole("button", { name: "「洗濯物」のメニュー" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "削除" }));
    const sheet = await screen.findByRole("dialog", {
      name: "カテゴリを削除",
    });
    const deleteButton = within(sheet).getByRole("button", {
      name: "削除する",
    });
    await waitFor(() => expect(deleteButton).toBeEnabled());
    await userEvent.click(deleteButton);
    expect(
      await screen.findByText(/件数が変わりました。リストを読み直しました/),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        callsTo(fetchMock, `/api/trips/${tripId}/todos`, "GET").length,
      ).toBeGreaterThan(1),
    );
  });

  it("「上へ移動」でfrom・toを送る。一番上の欄には「上へ移動」が無い（W-S08・E-03）", async () => {
    const fetchMock = stubApi({
      todos: () => ({
        categories: [
          cat(categoryA, "洗濯物"),
          cat(categoryB, "予約"),
          cat(categoryC, "買う"),
        ],
        items: [],
      }),
    });
    renderScreen(<TodosScreen tripId={tripId} />);
    // 先頭の欄のメニューには「上へ移動」が無い。
    await userEvent.click(
      await screen.findByRole("button", { name: "「洗濯物」のメニュー" }),
    );
    expect(
      screen.queryByRole("button", { name: "上へ移動" }),
    ).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "閉じる" }));
    await userEvent.click(
      await screen.findByRole("button", { name: "「予約」のメニュー" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "上へ移動" }),
    );
    const path = `/api/trips/${tripId}/todo-categories/order`;
    await waitFor(() =>
      expect(callsTo(fetchMock, path, "PUT")).toHaveLength(1),
    );
    const [, init] = callsTo(fetchMock, path, "PUT")[0]!;
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      from: [categoryA, categoryB, categoryC],
      to: [categoryB, categoryA, categoryC],
    });
  });

  it("行に期限・担当・関連する予定を出す（W-S09・F-11・F-17）", async () => {
    stubApi({
      todos: () => [
        todo({
          dueOn: "2026-10-05",
          assigneeId: otherUserId,
          plan: {
            id: planId,
            name: "新幹線で京都へ",
            date: "2026-10-12",
            cancelled: false,
          },
        }),
      ],
    });
    renderScreen(<TodosScreen tripId={tripId} />);
    expect(await screen.findByText("10/5まで")).toBeInTheDocument();
    expect(screen.getByText("担当: みお")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "10/12 新幹線で京都へ ›" }),
    ).toHaveAttribute("href", `/trips/${tripId}/plans/${planId}`);
  });

  it("完了の印を押した直後も予定のリンクが残る（W-S12・F-17）", async () => {
    let resolveComplete!: (response: Response) => void;
    const fetchMock = stubApi({
      todos: () => [
        todo({
          plan: {
            id: planId,
            name: "新幹線で京都へ",
            date: "2026-10-12",
            cancelled: false,
          },
        }),
      ],
      complete: () =>
        new Promise<Response>((resolve) => {
          resolveComplete = resolve;
        }),
    });
    renderScreen(<TodosScreen tripId={tripId} />);
    await userEvent.click(
      await screen.findByRole("button", {
        name: "「湯豆腐を食べる」を完了にする",
      }),
    );
    // 保存中の見た目でも予定のリンクが残る。
    expect(
      await screen.findByRole("link", { name: "10/12 新幹線で京都へ ›" }),
    ).toBeInTheDocument();
    const completePath = `/api/trips/${tripId}/todos/${todoId}/complete`;
    await waitFor(() =>
      expect(callsTo(fetchMock, completePath, "POST")).toHaveLength(1),
    );
    resolveComplete(
      json(
        todo({
          doneAt: "2026-11-08T05:00:00.000Z",
          doneBy: userId,
          plan: {
            id: planId,
            name: "新幹線で京都へ",
            date: "2026-10-12",
            cancelled: false,
          },
          version: "2",
        }),
      ),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("link", { name: "10/12 新幹線で京都へ ›" }),
      ).toBeInTheDocument(),
    );
  });

  it("オフラインでも絞り込み・たたむはできるが、追加・メニューは押せない（W-S13・E-11）", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    stubApi({
      todos: () => ({
        categories: [cat(categoryA, "洗濯物")],
        items: [todo({ categoryId: categoryA })],
      }),
    });
    renderScreen(<TodosScreen tripId={tripId} />);
    const toggle = await screen.findByRole("button", { name: /^洗濯物/ });
    expect(
      screen.getByRole("button", { name: "「洗濯物」のメニュー" }),
    ).toBeDisabled();
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    const filterButton = screen.getByRole("button", {
      name: "自分の担当",
    });
    expect(filterButton).toBeEnabled();
    await userEvent.click(filterButton);
    expect(filterButton).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: "カテゴリを追加" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "追加する" })).toBeDisabled();
  });

  it("名前の変更が競合したら「相手が先に変更しました」と出し読み直せる（W-S14・E-03）", async () => {
    const fetchMock = stubApi({
      todos: () => ({
        categories: [cat(categoryA, "洗濯物")],
        items: [],
      }),
      updateCategory: () =>
        json({ code: "VERSION_CONFLICT", message: "x" }, 409),
    });
    renderScreen(<TodosScreen tripId={tripId} />);
    await userEvent.click(
      await screen.findByRole("button", { name: "「洗濯物」のメニュー" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "名前を変更" }),
    );
    const sheet = await screen.findByRole("dialog", {
      name: "名前を変更",
    });
    const input = within(sheet).getByLabelText("名前");
    await waitFor(() => expect(input).not.toHaveAttribute("readonly"));
    await userEvent.clear(input);
    await userEvent.type(input, "お土産");
    await userEvent.click(
      within(sheet).getByRole("button", { name: "保存する" }),
    );
    const path = `/api/trips/${tripId}/todo-categories/${categoryA}`;
    await waitFor(() =>
      expect(callsTo(fetchMock, path, "PATCH")).toHaveLength(1),
    );
    expect(
      await within(sheet).findByText("相手が先に変更しました"),
    ).toBeInTheDocument();
    await userEvent.click(
      within(sheet).getByRole("button", {
        name: "最新の内容を読み込む",
      }),
    );
    await waitFor(() =>
      expect(
        callsTo(fetchMock, `/api/trips/${tripId}/todos`, "GET").length,
      ).toBeGreaterThan(1),
    );
  });

  it("カテゴリの追加はシートで送り、送ったら閉じる（F-06・E-01）", async () => {
    const fetchMock = stubApi({
      todos: () => ({ categories: [], items: [] }),
    });
    renderScreen(<TodosScreen tripId={tripId} />);
    await userEvent.click(
      await screen.findByRole("button", { name: "カテゴリを追加" }),
    );
    const sheet = await screen.findByRole("dialog", {
      name: "カテゴリを追加",
    });
    const input = within(sheet).getByLabelText("名前");
    await waitFor(() => expect(input).not.toHaveAttribute("readonly"));
    await userEvent.type(input, "洗濯物");
    await userEvent.click(
      within(sheet).getByRole("button", { name: "追加する" }),
    );
    const path = `/api/trips/${tripId}/todo-categories`;
    await waitFor(() =>
      expect(callsTo(fetchMock, path, "POST")).toHaveLength(1),
    );
    const [, init] = callsTo(fetchMock, path, "POST")[0]!;
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      name: "洗濯物",
    });
  });

  it("下のタブは5つで、ToDoが今のタブ。主ボタン「支払いを記録」は出さない", async () => {
    stubApi({ todos: () => [] });
    renderScreen(<TodosScreen tripId={tripId} />);
    const nav = await screen.findByRole("navigation", { name: "タブ" });
    expect(nav.querySelector('[aria-current="page"]')).toHaveTextContent(
      "ToDo",
    );
    expect(screen.queryByRole("link", { name: "支払いを記録" })).toBeNull();
  });
});

describe("ToDoの詳細", () => {
  it("未完了なら主ボタンは「予定にする」で、予定の追加をToDoから開く", async () => {
    stubApi({ todos: () => [todo()] });
    renderScreen(<TodoDetailScreen tripId={tripId} todoId={todoId} />);
    const button = await screen.findByRole("button", { name: "予定にする" });
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.click(button);
    expect(pushMock).toHaveBeenCalledWith(
      `/trips/${tripId}/plans/new?fromTodo=${todoId}`,
    );
  });

  it("完了なら主ボタンを出さない", async () => {
    stubApi({
      todos: () => [
        todo({ doneAt: "2026-11-08T05:00:00.000Z", doneBy: userId }),
      ],
    });
    renderScreen(<TodoDetailScreen tripId={tripId} todoId={todoId} />);
    expect(
      await screen.findByRole("button", { name: "未完了に戻す" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "予定にする" })).toBeNull();
    expect(screen.queryByRole("link", { name: "支払いを記録" })).toBeNull();
  });

  it("「変更を保存」は変えた項目だけを版つきで送る（F-06）", async () => {
    const fetchMock = stubApi({ todos: () => [todo()] });
    renderScreen(<TodoDetailScreen tripId={tripId} todoId={todoId} />);
    const memo = await screen.findByLabelText(/メモ/);
    // 保留の照合が終わるまでは欄を固定しているので、外れてから打つ。
    await waitFor(() => expect(memo).not.toHaveAttribute("readonly"));
    await userEvent.type(memo, "昼は混む");
    const save = screen.getByRole("button", { name: "変更を保存" });
    await waitFor(() => expect(save).toBeEnabled());
    await userEvent.click(save);
    await waitFor(() =>
      expect(
        callsTo(fetchMock, `/api/trips/${tripId}/todos/${todoId}`, "PATCH"),
      ).toHaveLength(1),
    );
    const [, init] = callsTo(
      fetchMock,
      `/api/trips/${tripId}/todos/${todoId}`,
      "PATCH",
    )[0]!;
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      memo: "昼は混む",
    });
    expect(
      new Headers((init as RequestInit).headers).get("X-Expected-Version"),
    ).toBe("1");
  });

  it("相手が先に変えていたら「相手が先に変更しました」を出す（E-03）", async () => {
    stubApi({
      todos: () => [todo()],
      update: () => json({ code: "VERSION_CONFLICT", message: "x" }, 409),
    });
    renderScreen(<TodoDetailScreen tripId={tripId} todoId={todoId} />);
    const memo = await screen.findByLabelText(/メモ/);
    await waitFor(() => expect(memo).not.toHaveAttribute("readonly"));
    await userEvent.type(memo, "昼は混む");
    const save = screen.getByRole("button", { name: "変更を保存" });
    await waitFor(() => expect(save).toBeEnabled());
    await userEvent.click(save);
    expect(
      await screen.findByText("相手が先に変更しました"),
    ).toBeInTheDocument();
  });

  it("打っている間に相手が名前を直していたら、送らずに「相手が先に変更しました」を出す", async () => {
    let current = todo();
    const fetchMock = stubApi({ todos: () => [current] });
    const client = createQueryClient();
    render(
      <QueryClientProvider client={client}>
        <TodoDetailScreen tripId={tripId} todoId={todoId} />
      </QueryClientProvider>,
    );
    const memo = await screen.findByLabelText(/メモ/);
    await waitFor(() => expect(memo).not.toHaveAttribute("readonly"));
    await userEvent.type(memo, "昼は混む");
    // 画面に戻ったときの取り直しで、相手の変更が届く。
    current = todo({ name: "湯豆腐と抹茶", version: "2" });
    await client.invalidateQueries();
    const save = screen.getByRole("button", { name: "変更を保存" });
    await waitFor(() => expect(save).toBeEnabled());
    await userEvent.click(save);
    expect(
      await screen.findByText("相手が先に変更しました"),
    ).toBeInTheDocument();
    expect(
      callsTo(fetchMock, `/api/trips/${tripId}/todos/${todoId}`, "PATCH"),
    ).toHaveLength(0);
  });

  it("打っている間に相手が完了の印を押しただけなら、新しい版で送る", async () => {
    let current = todo();
    const fetchMock = stubApi({ todos: () => [current] });
    const client = createQueryClient();
    render(
      <QueryClientProvider client={client}>
        <TodoDetailScreen tripId={tripId} todoId={todoId} />
      </QueryClientProvider>,
    );
    const memo = await screen.findByLabelText(/メモ/);
    await waitFor(() => expect(memo).not.toHaveAttribute("readonly"));
    await userEvent.type(memo, "昼は混む");
    current = todo({
      doneAt: "2026-11-08T05:00:00.000Z",
      doneBy: otherUserId,
      version: "2",
    });
    await client.invalidateQueries();
    await screen.findByRole("button", { name: "未完了に戻す" });
    const save = screen.getByRole("button", { name: "変更を保存" });
    await waitFor(() => expect(save).toBeEnabled());
    await userEvent.click(save);
    await waitFor(() =>
      expect(
        callsTo(fetchMock, `/api/trips/${tripId}/todos/${todoId}`, "PATCH"),
      ).toHaveLength(1),
    );
    const [, init] = callsTo(
      fetchMock,
      `/api/trips/${tripId}/todos/${todoId}`,
      "PATCH",
    )[0]!;
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      memo: "昼は混む",
    });
    expect(
      new Headers((init as RequestInit).headers).get("X-Expected-Version"),
    ).toBe("2");
  });

  it("削除は確認で「削除する」を押したときだけ送り、「やめる」なら送らない（F-08）", async () => {
    const fetchMock = stubApi({ todos: () => [todo()] });
    renderScreen(<TodoDetailScreen tripId={tripId} todoId={todoId} />);
    const deletePath = `/api/trips/${tripId}/todos/${todoId}/delete`;
    await userEvent.click(
      await screen.findByRole("button", { name: "削除する" }),
    );
    let dialog = await screen.findByRole("dialog", {
      name: /を削除しますか？$/,
    });
    await userEvent.click(
      within(dialog).getByRole("button", { name: "やめる" }),
    );
    expect(callsTo(fetchMock, deletePath, "POST")).toHaveLength(0);

    await userEvent.click(screen.getByRole("button", { name: "削除する" }));
    dialog = await screen.findByRole("dialog", { name: /を削除しますか？$/ });
    const confirm = within(dialog).getByRole("button", { name: "削除する" });
    await waitFor(() => expect(confirm).toBeEnabled());
    await userEvent.click(confirm);
    await waitFor(() =>
      expect(callsTo(fetchMock, deletePath, "POST")).toHaveLength(1),
    );
    await waitFor(() =>
      expect(replaceMock).toHaveBeenCalledWith(`/trips/${tripId}/todos`),
    );
  });

  it("別のToDoの削除の結果不明は、この詳細に出さず削除も止めない", async () => {
    const otherTodoId = "7b7b7b7b-7b7b-4b7b-8b7b-7b7b7b7b7b7b";
    stubApi({
      todos: () => [todo({ id: otherTodoId, name: "残るToDo" })],
    });
    await saveDeletePending(todoId);

    renderScreen(<TodoDetailScreen tripId={tripId} todoId={otherTodoId} />);
    await userEvent.click(
      await screen.findByRole("button", { name: "削除する" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: /を削除しますか？$/,
    });
    const confirm = within(dialog).getByRole("button", { name: "削除する" });
    await waitFor(() => expect(confirm).toBeEnabled());
    expect(screen.queryByText("保存されたか確認できません")).toBeNull();
  });

  it("このToDoの削除の結果不明は、詳細に「保存されたか確認できません」を出す", async () => {
    stubApi({ todos: () => [todo()] });
    await saveDeletePending(todoId);

    renderScreen(<TodoDetailScreen tripId={tripId} todoId={todoId} />);

    expect(
      await screen.findByText("保存されたか確認できません"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "同じ内容で確認する" }),
    ).toBeInTheDocument();
  });

  it("別のToDoの変更の結果不明は、この詳細に出さず変更も止めない", async () => {
    const otherTodoId = "7b7b7b7b-7b7b-4b7b-8b7b-7b7b7b7b7b7b";
    const fetchMock = stubApi({
      todos: () => [todo({ id: otherTodoId, name: "残るToDo" })],
    });
    await saveUpdatePending(todoId);

    renderScreen(<TodoDetailScreen tripId={tripId} todoId={otherTodoId} />);
    const memo = await screen.findByLabelText(/メモ/);
    await waitFor(() => expect(memo).not.toHaveAttribute("readonly"));
    await userEvent.type(memo, "昼は混む");
    const save = screen.getByRole("button", { name: "変更を保存" });
    await waitFor(() => expect(save).toBeEnabled());
    expect(screen.queryByText("保存されたか確認できません")).toBeNull();
    await userEvent.click(save);
    await waitFor(() =>
      expect(
        callsTo(fetchMock, `/api/trips/${tripId}/todos/${otherTodoId}`, "PATCH"),
      ).toHaveLength(1),
    );
  });

  it("このToDoの変更の結果不明は、詳細に「保存されたか確認できません」を出し、欄を固定する", async () => {
    stubApi({ todos: () => [todo()] });
    await saveUpdatePending(todoId);

    renderScreen(<TodoDetailScreen tripId={tripId} todoId={todoId} />);

    expect(
      (await screen.findAllByText("保存されたか確認できません")).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByRole("button", { name: "同じ内容で確認する" }).length,
    ).toBeGreaterThan(0);
    expect(await screen.findByLabelText(/内容/)).toHaveAttribute(
      "data-locked",
      "true",
    );
    expect(screen.getByLabelText(/メモ/)).toHaveAttribute(
      "data-locked",
      "true",
    );
  });

  it("相手が先に消していたら、開けない表示にする（E-04）", async () => {
    stubApi({ todos: () => [] });
    renderScreen(<TodoDetailScreen tripId={tripId} todoId={todoId} />);
    expect(
      await screen.findByRole("button", { name: "ToDoに戻る" }),
    ).toBeInTheDocument();
  });
});

  it("担当を選ぶとすぐPATCHを送る。内容の欄は変えない（W-S10・F-22）", async () => {
    const fetchMock = stubApi({
      todos: () => [todo()],
      update: () => json(todo({ assigneeId: userId, version: "2" })),
    });
    renderScreen(<TodoDetailScreen tripId={tripId} todoId={todoId} />);
    const row = await screen.findByRole("button", { name: /担当/ });
    await waitFor(() => expect(row).toBeEnabled());
    await userEvent.click(row);
    const sheet = await screen.findByRole("dialog", { name: "担当" });
    await userEvent.click(
      within(sheet).getByRole("button", { name: "あなた" }),
    );
    const path = `/api/trips/${tripId}/todos/${todoId}`;
    await waitFor(() =>
      expect(callsTo(fetchMock, path, "PATCH")).toHaveLength(1),
    );
    const [, init] = callsTo(fetchMock, path, "PATCH")[0]!;
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      assigneeId: userId,
    });
    // 内容の欄は変えない。
    expect(screen.getByLabelText("内容")).toHaveValue("湯豆腐を食べる");
  });

  it("内容の保存中はカテゴリの行が押せず、カテゴリの保存中は「変更を保存」が押せない", async () => {
    let resolvePatch!: (response: Response) => void;
    const fetchMock = stubApi({
      todos: () => ({
        categories: [cat(categoryA, "洗濯物")],
        items: [todo()],
      }),
      update: () =>
        new Promise<Response>((resolve) => {
          resolvePatch = resolve;
        }),
    });
    renderScreen(<TodoDetailScreen tripId={tripId} todoId={todoId} />);
    const path = `/api/trips/${tripId}/todos/${todoId}`;

    // 内容の保存の応答を待つあいだは、カテゴリの行を押せない。
    const nameInput = await screen.findByLabelText("内容");
    await waitFor(() => expect(nameInput).not.toHaveAttribute("readonly"));
    await userEvent.type(nameInput, "変更した内容");
    const saveButton = screen.getByRole("button", { name: "変更を保存" });
    await waitFor(() => expect(saveButton).toBeEnabled());
    await userEvent.click(saveButton);
    await waitFor(() =>
      expect(callsTo(fetchMock, path, "PATCH")).toHaveLength(1),
    );
    expect(
      screen.getByRole("button", { name: /カテゴリ/ }),
    ).toBeDisabled();
    resolvePatch(json(todo({ name: "変更した内容", version: "2" })));

    // 逆に、カテゴリの保存中は「変更を保存」を押せない。
    const row = await screen.findByRole("button", { name: /カテゴリ/ });
    await waitFor(() => expect(row).toBeEnabled());
    await userEvent.click(row);
    const sheet = await screen.findByRole("dialog", { name: "カテゴリ" });
    await userEvent.click(
      within(sheet).getByRole("button", { name: "洗濯物" }),
    );
    await waitFor(() =>
      expect(callsTo(fetchMock, path, "PATCH")).toHaveLength(2),
    );
    expect(screen.getByRole("button", { name: "変更を保存" })).toBeDisabled();
    expect(
      within(sheet).getByRole("button", { name: "未分類" }),
    ).toBeDisabled();
    resolvePatch(json(todo({ categoryId: categoryA, version: "3" })));
  });

  it("オフラインでは、カテゴリ・担当・期限のシートの保存を押せない（E-11）", async () => {
    stubApi({
      todos: () => ({
        categories: [cat(categoryA, "洗濯物")],
        items: [todo({ dueOn: "2099-01-01" })],
      }),
    });
    renderScreen(<TodoDetailScreen tripId={tripId} todoId={todoId} />);
    const row = await screen.findByRole("button", { name: /期限/ });
    await waitFor(() => expect(row).toBeEnabled());
    await userEvent.click(row);
    const sheet = await screen.findByRole("dialog", { name: "期限" });
    // シートを開いたあとに電波が切れても、保存の操作は押せない。
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    await act(async () => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(
      within(sheet).getByRole("button", { name: "決定" }),
    ).toBeDisabled();
    expect(
      within(sheet).getByRole("button", { name: "期限を消す" }),
    ).toBeDisabled();
    // React QueryのonlineManagerもofflineになるため、あとの試験のために戻す。
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
  });

  it("期限が過ぎたToDoは「期限切れ」を出す（W-S11・F-12）", async () => {
    stubApi({
      todos: () => [todo({ dueOn: "2000-01-01" })],
    });
    renderScreen(<TodoDetailScreen tripId={tripId} todoId={todoId} />);
    expect(await screen.findByText("期限切れ")).toBeInTheDocument();
  });

describe("予定の追加をToDoから開いたとき（F-09・F-10）", () => {
  it("ToDoの一覧が読めなくても、送る本文にfromTodoIdが付く", async () => {
    const fetchMock = stubApi({
      todos: () => json({ code: "TEMPORARILY_UNAVAILABLE", message: "x" }, 503),
    });
    renderScreen(
      <PlanFormScreen
        mode="new"
        tripId={tripId}
        date={null}
        fromTodoId={todoId}
      />,
    );
    const nameBox = await screen.findByRole("textbox", { name: /名前/ });
    const dialog = await screen.findByRole("dialog", { name: "予定を追加" });
    await waitFor(() => expect(nameBox).not.toHaveAttribute("readonly"));
    await userEvent.type(nameBox, "湯豆腐");
    await userEvent.click(
      within(dialog).getByRole("radio", { name: /食べ処/ }),
    );
    const save = within(dialog).getByRole("button", { name: "保存" });
    await waitFor(() => expect(save).toBeEnabled());
    await userEvent.click(save);
    await waitFor(() =>
      expect(
        callsTo(fetchMock, `/api/trips/${tripId}/plans`, "POST"),
      ).toHaveLength(1),
    );
    const [, init] = callsTo(
      fetchMock,
      `/api/trips/${tripId}/plans`,
      "POST",
    )[0]!;
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      fromTodoId: todoId,
    });
  });

  it("名前とメモが入り、説明が出て、送る本文にfromTodoIdが付く", async () => {
    const fetchMock = stubApi({
      todos: () => [todo({ memo: "南禅寺のそば" })],
      createPlan: () =>
        json(
          {
            id: planId,
            tripId,
            name: "湯豆腐を食べる",
            kind: "food",
            date: "2026-10-12",
            time: null,
            memo: "南禅寺のそば",
            cancelledAt: null,
            cancelledBy: null,
            version: "1",
            achievement: null,
            booking: null,
            canChangeKind: true,
            kindChangeReason: null,
          },
          201,
        ),
    });
    renderScreen(
      <PlanFormScreen
        mode="new"
        tripId={tripId}
        date={null}
        fromTodoId={todoId}
      />,
    );
    expect(
      await screen.findByText(
        "ToDoの「湯豆腐を食べる」から作ります。保存すると、ToDoは完了になります。",
      ),
    ).toBeInTheDocument();
    // シートはeffectでshowModalしてから読み上げの木に入るので、開くまで待つ。
    const dialog = await screen.findByRole("dialog", { name: "予定を追加" });
    await waitFor(() =>
      expect(within(dialog).getByRole("textbox", { name: /名前/ })).toHaveValue(
        "湯豆腐を食べる",
      ),
    );
    expect(within(dialog).getByRole("textbox", { name: /メモ/ })).toHaveValue(
      "南禅寺のそば",
    );
    await userEvent.click(
      within(dialog).getByRole("radio", { name: /食べ処/ }),
    );
    const save = within(dialog).getByRole("button", { name: "保存" });
    await waitFor(() => expect(save).toBeEnabled());
    await userEvent.click(save);
    await waitFor(() =>
      expect(
        callsTo(fetchMock, `/api/trips/${tripId}/plans`, "POST"),
      ).toHaveLength(1),
    );
    const [, init] = callsTo(
      fetchMock,
      `/api/trips/${tripId}/plans`,
      "POST",
    )[0]!;
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      name: "湯豆腐を食べる",
      memo: "南禅寺のそば",
      fromTodoId: todoId,
    });
  });
});
