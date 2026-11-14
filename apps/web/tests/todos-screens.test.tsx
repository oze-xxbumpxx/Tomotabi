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
import type { Todo, Trip } from "@tomotabi/contracts";
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

/** /api/me・旅行・残額・ToDo・予定の追加をURLとメソッドで振り分けるfake。 */
function stubApi(handlers: {
  todos?: () => Todo[] | Response;
  create?: Handler;
  complete?: Handler;
  update?: Handler;
  remove?: Handler;
  createPlan?: Handler;
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
      const result = handlers.todos?.() ?? [];
      return Promise.resolve(
        result instanceof Response
          ? result
          : json({ categories: [], items: result }),
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

  it("まだ・済んだに分け、誰が追加・完了したかと予定へのリンクを出す（F-03・F-04・F-16）", async () => {
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
    const open = await screen.findByRole("region", { name: "まだのもの" });
    expect(within(open).getByText("まだ · 2件")).toBeInTheDocument();
    expect(within(open).getByText("あなたが追加した")).toBeInTheDocument();
    expect(
      within(open).getByText("みおが追加した · メモあり"),
    ).toBeInTheDocument();
    const done = screen.getByRole("region", { name: "済んだもの" });
    expect(within(done).getByText("済んだ · 2件")).toBeInTheDocument();
    expect(
      within(done).getByRole("link", { name: "10/13(火) の予定 ›" }),
    ).toHaveAttribute("href", `/trips/${tripId}/plans/${planId}`);
    expect(
      within(done).getByRole("link", { name: "取りやめた予定 ›" }),
    ).toBeInTheDocument();
    expect(within(done).getByText(/みおが予定にした/)).toBeInTheDocument();
  });

  it("全部済んだら、まだの欄に「すべて済みました」（B-05）", async () => {
    stubApi({
      todos: () => [
        todo({ doneAt: "2026-11-08T05:00:00.000Z", doneBy: userId }),
      ],
    });
    renderScreen(<TodosScreen tripId={tripId} />);
    expect(await screen.findByText("すべて済みました")).toBeInTheDocument();
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
