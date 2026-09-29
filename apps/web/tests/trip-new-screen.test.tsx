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
import { createQueryClient } from "@/shared/api/query-client";

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

function stubApi(
  create: (init?: RequestInit) => Response | Promise<Response>,
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    if (url === "/api/trips" && init?.method === "POST") {
      return Promise.resolve(create(init));
    }
    return Promise.resolve(
      new Response(JSON.stringify({ code: "NOT_FOUND" }), { status: 404 }),
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("TripNewScreen (/trips/new)", () => {
  it("W-06: 空白だけの名前は欄のエラーにして最初の欄へフォーカスする", async () => {
    stubApi(() => new Response(JSON.stringify(tripBody), { status: 201 }));
    renderScreen();

    fireEvent.change(screen.getByLabelText("旅行名"), {
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

    fireEvent.change(screen.getByLabelText("旅行名"), {
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
    // エラーのある送信は API に届かない。
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("W-06: 絵文字 51 個（UTF-16 で 102）の名前は通る（境界）", async () => {
    const fetchMock = stubApi(() =>
      new Response(JSON.stringify(tripBody), { status: 201 }),
    );
    renderScreen();

    const emojiName = "🍡".repeat(51);
    fireEvent.change(screen.getByLabelText("旅行名"), {
      target: { value: emojiName },
    });
    fillDates("2026-10-12", "2026-10-14");
    await userEvent.click(
      screen.getByRole("button", { name: "旅行をつくる" }),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(
      JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).name,
    ).toBe(emojiName);
  });

  it("W-06: 絵文字 100 個の名前は通る（コードポイントで数える）", async () => {
    const fetchMock = stubApi(() =>
      new Response(JSON.stringify(tripBody), { status: 201 }),
    );
    renderScreen();

    const emojiName = "😀".repeat(100);
    fireEvent.change(screen.getByLabelText("旅行名"), {
      target: { value: emojiName },
    });
    fillDates("2026-10-12", "2026-10-14");
    await userEvent.click(
      screen.getByRole("button", { name: "旅行をつくる" }),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, init] = fetchMock.mock.calls[0];
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

    fireEvent.change(screen.getByLabelText("旅行名"), {
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
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/trips");
    const headers = new Headers(init?.headers);
    expect(headers.get("idempotency-key")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    // 前後の空白は除いて送る。
    expect(JSON.parse(String(init?.body)).name).toBe("沖縄");
  });

  it("結果不明（通信失敗）は入力を固定し、同じ要求でだけ確認できる", async () => {
    let calls = 0;
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, _init?: RequestInit) => {
        calls += 1;
        if (calls === 1) {
          return Promise.reject(new TypeError("Failed to fetch"));
        }
        return Promise.resolve(
          new Response(JSON.stringify(tripBody), { status: 201 }),
        );
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    renderScreen();

    fireEvent.change(screen.getByLabelText("旅行名"), {
      target: { value: "沖縄" },
    });
    fillDates("2026-10-12", "2026-10-14");
    await userEvent.click(
      screen.getByRole("button", { name: "旅行をつくる" }),
    );

    expect(
      await screen.findByText("保存されたか確認できません"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("旅行名")).toHaveAttribute("readonly");
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
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // 2 回目は 1 回目と同じキー・本文（別の要求を作らない）。
    const first = fetchMock.mock.calls[0][1];
    const second = fetchMock.mock.calls[1][1];
    expect(new Headers(second?.headers).get("idempotency-key")).toBe(
      new Headers(first?.headers).get("idempotency-key"),
    );
    expect(second?.body).toBe(first?.body);
  });
});
