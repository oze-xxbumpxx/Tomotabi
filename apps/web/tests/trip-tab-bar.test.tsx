import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TripTabBar, type TripTab } from "@/features/trips";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const tripId = "8a6e0804-2bd0-4672-b79d-d97027f9071a";

const TABS: { current: TripTab; name: string; href: string }[] = [
  { current: "home", name: "ホーム", href: `/trips/${tripId}/home` },
  {
    current: "itinerary",
    name: "しおり",
    href: `/trips/${tripId}/itinerary`,
  },
  { current: "records", name: "記録", href: `/trips/${tripId}/records` },
  {
    current: "settlement",
    name: "精算",
    href: `/trips/${tripId}/settlement`,
  },
];

describe("TripTabBar（RW-01: 共通の下のタブ）", () => {
  it("4つのタブと「支払いを記録」を出し、今のタブにだけ aria-current を付ける", () => {
    render(<TripTabBar tripId={tripId} current="itinerary" />);
    const nav = screen.getByRole("navigation", { name: "タブ" });

    for (const { current, name, href } of TABS) {
      if (current === "itinerary") {
        // 今のタブはリンクではなく、aria-current="page" の項目。
        expect(
          within(nav).queryByRole("link", { name }),
        ).toBeNull();
        continue;
      }
      expect(within(nav).getByRole("link", { name })).toHaveAttribute(
        "href",
        href,
      );
    }
    const currentItem = nav.querySelector('[aria-current="page"]');
    expect(currentItem).toHaveTextContent("しおり");
    expect(nav.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    // 「支払いを記録」はタブの外の主ボタン（planIdは付けない）。
    expect(
      screen.getByRole("link", { name: "支払いを記録" }),
    ).toHaveAttribute("href", `/trips/${tripId}/payments/new`);
  });

  it.each(TABS.map(({ current, name }) => [current, name] as const))(
    "%s が今いるタブならその項目にだけ aria-current を付ける",
    (current, name) => {
      render(<TripTabBar tripId={tripId} current={current} />);
      const nav = screen.getByRole("navigation", { name: "タブ" });
      expect(
        nav.querySelectorAll('[aria-current="page"]'),
      ).toHaveLength(1);
      expect(
        nav.querySelector('[aria-current="page"]'),
      ).toHaveTextContent(name);
      // ほかの3つはリンクのまま（4つのタブは同じ旅行を向く）。
      expect(within(nav).getAllByRole("link")).toHaveLength(3);
      cleanup();
    },
  );

  it("オフラインなら「支払いを記録」はリンクでなく aria-disabled", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    render(<TripTabBar tripId={tripId} current="settlement" />);
    expect(
      screen.queryByRole("link", { name: "支払いを記録" }),
    ).toBeNull();
    expect(
      screen.getByText("支払いを記録").closest("[aria-disabled]"),
    ).toHaveAttribute("aria-disabled", "true");
  });
});
