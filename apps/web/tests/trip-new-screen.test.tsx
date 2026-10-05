import "fake-indexeddb/auto";
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
import type { Trip } from "@tomotabi/contracts";
import { CREATE_TRIP_OPERATION } from "@/features/trips";
import { createMutationRequest } from "@/shared/api/mutation-request";
import { createQueryClient } from "@/shared/api/query-client";
import {
  findPendingRequest,
  NEW_TRIP_ID,
  savePendingRequest,
  toPendingRequestRecord,
} from "@/shared/browser/pending-requests";

const { replaceMock, pushMock } = vi.hoisted(() => ({
  replaceMock: vi.fn(),
  pushMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, push: pushMock }),
}));

import { TripNewScreen } from "@/screens/trips/trip-new-screen";

const userId = "550e8400-e29b-41d4-a716-446655440000";
const tripId = "8a6e0804-2bd0-4672-b79d-d97027f9071a";

const tripBody: Trip = {
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

const meBody = {
  user: { id: userId, displayName: "ひなた" },
  sessionExpiresAt: "2026-10-03T07:43:00.000Z",
};

function urlOf(input: RequestInfo | URL): string {
  return typeof input === "string"
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function stubApi(
  create: (init?: RequestInit) => Response | Promise<Response>,
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = urlOf(input);
    if (url === "/api/me") {
      return Promise.resolve(json(meBody));
    }
    if (url === "/api/trips" && init?.method === "POST") {
      return Promise.resolve(create(init));
    }
    // シートの下に敷く旅行一覧。
    if (url.startsWith("/api/trips") && (init?.method ?? "GET") === "GET") {
      return Promise.resolve(
        json({ items: [tripBody], nextCursor: null }),
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify({ code: "NOT_FOUND" }), { status: 404 }),
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function writeCalls(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(
    (call) => (call[1]?.method ?? "GET") !== "GET",
  );
}

function renderScreen(): void {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <TripNewScreen />
    </QueryClientProvider>,
  );
}

function fillDates(startsOn: string, endsOn: string): void {
  fireEvent.change(screen.getByLabelText("開始日"), {
    target: { value: startsOn },
  });
  fireEvent.change(screen.getByLabelText("終了日"), {
    target: { value: endsOn },
  });
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

describe("TripNewScreen (/trips/new)", () => {
  it("W-06: 空白だけの名前は欄のエラーにして最初の欄へフォーカスする", async () => {
    stubApi(() => new Response(JSON.stringify(tripBody), { status: 201 }));
    renderScreen();

    fireEvent.change(await screen.findByLabelText("旅行名"), {
      target: { value: "   " },
    });
    fillDates("2026-10-12", "2026-10-14");
    await userEvent.click(
      screen.getByRole("button", { name: "旅行をつくる" }),
    );

    expect(
      await screen.findByText("旅行名を入力してください"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("旅行名")).toHaveFocus();
    expect(
      screen.queryByText(/開始日を入力|終了日を入力|実在する/),
    ).not.toBeInTheDocument();
  });

  it("W-06: 101 文字の名前はエラー、開始 > 終了は終了日のエラー", async () => {
    const fetchMock = stubApi(() =>
      new Response(JSON.stringify(tripBody), { status: 201 }),
    );
    renderScreen();

    fireEvent.change(await screen.findByLabelText("旅行名"), {
      target: { value: "あ".repeat(101) },
    });
    fillDates("2026-10-14", "2026-10-12");
    await userEvent.click(
      screen.getByRole("button", { name: "旅行をつくる" }),
    );

    expect(
      await screen.findByText("旅行名は 100 文字以内で入力してください"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("終了日は開始日以降の日付にしてください"),
    ).toBeInTheDocument();
    // エラーのある送信はAPIに届かない（一覧の読み取りだけが飛ぶ）。
    expect(writeCalls(fetchMock)).toHaveLength(0);
  });

  it("W-06: 絵文字 51 個（UTF-16 で 102）の名前は通る（境界）", async () => {
    const fetchMock = stubApi(() =>
      new Response(JSON.stringify(tripBody), { status: 201 }),
    );
    renderScreen();

    const emojiName = "🍡".repeat(51);
    fireEvent.change(await screen.findByLabelText("旅行名"), {
      target: { value: emojiName },
    });
    fillDates("2026-10-12", "2026-10-14");
    await userEvent.click(
      screen.getByRole("button", { name: "旅行をつくる" }),
    );

    await waitFor(() => expect(writeCalls(fetchMock)).toHaveLength(1));
    expect(
      JSON.parse(String(writeCalls(fetchMock)[0][1]?.body)).name,
    ).toBe(emojiName);
  });

  it("W-06: 絵文字 100 個の名前は通る（コードポイントで数える）", async () => {
    const fetchMock = stubApi(() =>
      new Response(JSON.stringify(tripBody), { status: 201 }),
    );
    renderScreen();

    const emojiName = "😀".repeat(100);
    fireEvent.change(await screen.findByLabelText("旅行名"), {
      target: { value: emojiName },
    });
    fillDates("2026-10-12", "2026-10-14");
    await userEvent.click(
      screen.getByRole("button", { name: "旅行をつくる" }),
    );

    await waitFor(() => expect(writeCalls(fetchMock)).toHaveLength(1));
    const [, init] = writeCalls(fetchMock)[0];
    expect(JSON.parse(String(init?.body))).toEqual({
      name: emojiName,
      startsOn: "2026-10-12",
      endsOn: "2026-10-14",
    });
    expect(
      screen.queryByText("旅行名は 100 文字以内で入力してください"),
    ).not.toBeInTheDocument();
  });

  it("作成できたら Idempotency-Key を付けて送り、作った旅行のしおりへ", async () => {
    const fetchMock = stubApi(() =>
      new Response(JSON.stringify(tripBody), { status: 201 }),
    );
    renderScreen();

    fireEvent.change(await screen.findByLabelText("旅行名"), {
      target: { value: "  沖縄  " },
    });
    fillDates("2026-10-12", "2026-10-14");
    await userEvent.click(
      screen.getByRole("button", { name: "旅行をつくる" }),
    );

    await waitFor(() =>
      expect(replaceMock).toHaveBeenCalledWith(
        `/trips/${tripId}/itinerary`,
      ),
    );
    const [url, init] = writeCalls(fetchMock)[0];
    expect(url).toBe("/api/trips");
    const headers = new Headers(init?.headers);
    expect(headers.get("idempotency-key")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    // 前後の空白は除いて送る。
    expect(JSON.parse(String(init?.body)).name).toBe("沖縄");
  });

  it("結果不明（通信失敗）は入力を固定し、同じ要求でだけ確認できる", async () => {
    const posts: RequestInit[] = [];
    const fetchMock = vi.fn(
      (input: RequestInfo | URL, init?: RequestInit) => {
        const url = urlOf(input);
        if (url === "/api/me") {
          return Promise.resolve(json(meBody));
        }
        if (url === "/api/trips" && init?.method === "POST") {
          posts.push(init);
          if (posts.length === 1) {
            return Promise.reject(new TypeError("Failed to fetch"));
          }
          return Promise.resolve(json(tripBody, 201));
        }
        if (url.startsWith("/api/trips")) {
          return Promise.resolve(
            json({ items: [tripBody], nextCursor: null }),
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify({ code: "NOT_FOUND" }), {
            status: 404,
          }),
        );
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    renderScreen();

    fireEvent.change(await screen.findByLabelText("旅行名"), {
      target: { value: "沖縄" },
    });
    fillDates("2026-10-12", "2026-10-14");
    await userEvent.click(
      screen.getByRole("button", { name: "旅行をつくる" }),
    );

    expect(
      await screen.findByText("保存されたか確認できません"),
    ).toBeInTheDocument();
    expect(await screen.findByLabelText("旅行名")).toHaveAttribute(
      "readonly",
    );
    expect(
      screen.queryByRole("button", { name: "旅行をつくる" }),
    ).not.toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: "同じ内容で確認する" }),
    );

    await waitFor(() =>
      expect(replaceMock).toHaveBeenCalledWith(
        `/trips/${tripId}/itinerary`,
      ),
    );
    expect(posts).toHaveLength(2);
    // 2回目は1回目と同じキー・本文（別の要求を作らない）。
    const [first, second] = posts;
    expect(new Headers(second?.headers).get("idempotency-key")).toBe(
      new Headers(first?.headers).get("idempotency-key"),
    );
    expect(second?.body).toBe(first?.body);
  });

  it("旅行一覧の上にシートで開き、最初の欄にフォーカスする", async () => {
    stubApi(() => json(tripBody, 201));
    renderScreen();

    expect(
      await screen.findByRole("dialog", { name: "新しい旅行" }),
    ).toBeInTheDocument();
    // シートの後ろに元の画面（旅行一覧）が透けて見える。
    expect(await screen.findByText("沖縄")).toBeInTheDocument();
    // 開いたときのフォーカスは「×」ではなく最初の欄。
    expect(await screen.findByLabelText("旅行名")).toHaveFocus();
  });

  it("「やめる」は送らず旅行一覧へ戻る", async () => {
    const fetchMock = stubApi(() => json(tripBody, 201));
    renderScreen();

    await screen.findByRole("dialog", { name: "新しい旅行" });
    // 保留の照合が終わってフォームが出るまで待つ。
    await screen.findByLabelText("旅行名");
    await userEvent.click(screen.getByRole("button", { name: "やめる" }));

    expect(pushMock).toHaveBeenCalledWith("/trips");
    expect(writeCalls(fetchMock)).toHaveLength(0);
  });

  it("RW-02: 「旅行をつくる」は new-trip の操作として端末に残してから送る", async () => {
    // 作成の応答を保留にして、送信の前に端末へ残ったことを確かめる。
    const fetchMock = vi.fn(
      (input: RequestInfo | URL, init?: RequestInit) => {
        const url = urlOf(input);
        if (url === "/api/me") {
          return Promise.resolve(json(meBody));
        }
        if (url === "/api/trips" && init?.method === "POST") {
          return new Promise<Response>(() => {});
        }
        if (url.startsWith("/api/trips")) {
          return Promise.resolve(
            json({ items: [tripBody], nextCursor: null }),
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify({ code: "NOT_FOUND" }), {
            status: 404,
          }),
        );
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    renderScreen();

    fireEvent.change(await screen.findByLabelText("旅行名"), {
      target: { value: "沖縄" },
    });
    fillDates("2026-10-12", "2026-10-14");
    await userEvent.click(
      screen.getByRole("button", { name: "旅行をつくる" }),
    );

    await waitFor(() => expect(writeCalls(fetchMock)).toHaveLength(1));
    // 送った要求は、new-trip の tripId・create-trip の操作として
    // 端末に残っている（応答はまだ無い）。
    const lookup = await findPendingRequest({
      userId,
      tripId: NEW_TRIP_ID,
      operation: CREATE_TRIP_OPERATION,
    });
    expect(lookup.status).toBe("found");
    if (lookup.status !== "found") {
      throw new Error("unreachable");
    }
    expect(lookup.record.url).toBe("/api/trips");
    const body =
      lookup.record.bodyJson !== null
        ? (JSON.parse(lookup.record.bodyJson) as { name?: string })
        : null;
    expect(body?.name).toBe("沖縄");
    // 送った要求と端末に残した要求は同じ冪等キー。
    const [, init] = writeCalls(fetchMock)[0];
    expect(new Headers(init?.headers).get("idempotency-key")).toBe(
      lookup.record.idempotencyKey,
    );
  });

  it("RW-02: 端末に残せなければ送らずに止めて案内を出す", async () => {
    const fetchMock = stubApi(() => json(tripBody, 201));
    renderScreen();

    fireEvent.change(await screen.findByLabelText("旅行名"), {
      target: { value: "沖縄" },
    });
    fillDates("2026-10-12", "2026-10-14");

    const putSpy = vi
      .spyOn(IDBObjectStore.prototype, "put")
      .mockImplementation(() => {
        throw new DOMException("writes blocked", "InvalidStateError");
      });
    try {
      await userEvent.click(
        screen.getByRole("button", { name: "旅行をつくる" }),
      );
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

  it("RW-04: 新規作成の保留があれば欄を固定して戻し、同じ内容で確認できる", async () => {
    const record = toPendingRequestRecord({
      userId,
      tripId: NEW_TRIP_ID,
      request: createMutationRequest({
        operation: CREATE_TRIP_OPERATION,
        url: "/api/trips",
        method: "POST",
        body: {
          name: "沖縄",
          startsOn: "2026-10-12",
          endsOn: "2026-10-14",
        },
      }),
    });
    await savePendingRequest(record);
    const fetchMock = stubApi(() => json(tripBody, 201));
    renderScreen();

    // 欄は残した内容で固定して戻し、保存のボタンは出さない。
    expect(
      await screen.findByText("保存されたか確認できません"),
    ).toBeInTheDocument();
    const nameInput = await screen.findByLabelText("旅行名");
    expect(nameInput).toHaveAttribute("readonly");
    expect(nameInput).toHaveValue("沖縄");
    expect(screen.getByLabelText("開始日")).toHaveAttribute("readonly");
    expect(
      screen.queryByRole("button", { name: "旅行をつくる" }),
    ).not.toBeInTheDocument();

    // 「同じ内容で確認する」は保存済みの要求をそのまま送る。
    await userEvent.click(
      screen.getByRole("button", { name: "同じ内容で確認する" }),
    );
    await waitFor(() =>
      expect(replaceMock).toHaveBeenCalledWith(
        `/trips/${tripId}/itinerary`,
      ),
    );
    const [url, init] = writeCalls(fetchMock)[0];
    expect(url).toBe("/api/trips");
    expect(new Headers(init?.headers).get("idempotency-key")).toBe(
      record.idempotencyKey,
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      name: "沖縄",
      startsOn: "2026-10-12",
      endsOn: "2026-10-14",
    });
  });
});
