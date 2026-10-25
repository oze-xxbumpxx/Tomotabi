import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Home } from "@/features/trips";

// アイコンの種類をDOMから確かめるため、svgに名前を残す。
vi.mock("@phosphor-icons/react", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const mark = (name: string) => {
    const Icon = (props: object) => (
      <svg data-icon={name} aria-hidden="true" {...props} />
    );
    return Icon;
  };
  return {
    ...actual,
    CaretDown: mark("CaretDown"),
    CaretRight: mark("CaretRight"),
    ArrowsClockwise: mark("ArrowsClockwise"),
  };
});

import { TripMenu } from "@/features/trips/ui/trip-menu";
import { HomeHeader } from "@/screens/home/home-header";

const tripId = "8a6e0804-2bd0-4672-b79d-d97027f9071a";
const userId = "550e8400-e29b-41d4-a716-446655440000";

const home: Home = {
  trip: {
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
  },
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
    data: { date: "2026-10-12", items: [], totalCount: 0, achievedCount: 0 },
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
};

function renderMenu() {
  return render(
    <TripMenu
      trip={home.trip}
      version="1"
      displayName="ひなた"
      start={
        {
          state: { status: "editing" },
          submit: vi.fn(),
          backToEditing: vi.fn(),
          confirmRequest: vi.fn(),
        } as never
      }
      startPending={{ check: { status: "none" }, reload: vi.fn() } as never}
      onEdit={vi.fn()}
      onRequestFinish={vi.fn()}
      onSwitch={vi.fn()}
      onSignOut={vi.fn()}
      signOutPending={false}
      signOutFailure={null}
      onClose={vi.fn()}
    />,
  );
}

afterEach(() => {
  cleanup();
});

describe("Issue #290: 切り替えの矢印とログアウトの区切り", () => {
  it("ヘッダーの「切り替え」は旅行の一覧へのリンクのまま、下向きの矢印を使わない", () => {
    render(<HomeHeader home={home} now={null} onOpenMenu={vi.fn()} />);
    const link = screen.getByRole("link", { name: /切り替え/ });
    expect(link).toHaveAttribute("href", "/trips");
    expect(link.querySelector('[data-icon="CaretRight"]')).not.toBeNull();
    expect(link.querySelector('[data-icon="CaretDown"]')).toBeNull();
  });

  it("メニューの項目の並び（旅行を切り替え・この端末の通知・ログアウト）は変わらない", () => {
    renderMenu();
    const labels = Array.from(document.querySelectorAll(".menu-item")).map(
      (item) => item.querySelector(".menu-item-label")?.textContent,
    );
    expect(labels).toEqual([
      "旅行名と期間を変更",
      "旅行を開始する",
      "旅行を切り替え",
      "この端末の通知",
      "ログアウト",
    ]);
    // 切り替えの左のアイコンはドロップダウンに見えないもの（下向きの矢印ではない）。
    const switchItem = screen.getByRole("button", { name: /旅行を切り替え/ });
    expect(
      switchItem.querySelector('[data-icon="ArrowsClockwise"]'),
    ).not.toBeNull();
    expect(switchItem.querySelector('[data-icon="CaretDown"]')).toBeNull();
    // ログアウトは区切りのすぐ下。
    const signOut = screen.getByRole("button", { name: /ログアウト/ });
    const sep = signOut.previousElementSibling;
    expect(sep).not.toBeNull();
    expect(sep?.classList.contains("menu-sep")).toBe(true);
  });
});
