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
  { current: "todos", name: "ToDo", href: `/trips/${tripId}/todos` },
  { current: "records", name: "履歴", href: `/trips/${tripId}/records` },
  {
    current: "settlement",
    name: "精算",
    href: `/trips/${tripId}/settlement`,
  },
];

describe("TripTabBar（RW-01: 共通の下のタブ）", () => {
  it("5つのタブ（ホーム・しおり・ToDo・履歴・精算の順）と「支払いを記録」を出し、今のタブにだけ aria-current を付ける", () => {
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
    // 並びは ホーム・しおり・ToDo・履歴・精算（設計書 trip-todo）。
    expect(
      [...nav.querySelectorAll(".tabbar-item")].map((el) => el.textContent),
    ).toEqual(["ホーム", "しおり", "ToDo", "履歴", "精算"]);
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
      // ほかの4つはリンクのまま（5つのタブは同じ旅行を向く）。
      expect(within(nav).getAllByRole("link")).toHaveLength(4);
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

describe("「支払いを記録」は、開いた画面を back で渡す", () => {
  it.each(["home", "records"] as const)("%s から開くと ?back=%s が付く", (current) => {
    render(<TripTabBar tripId={tripId} current={current} />);
    expect(
      screen.getByRole("link", { name: "支払いを記録" }),
    ).toHaveAttribute("href", `/trips/${tripId}/payments/new?back=${current}`);
  });
});

describe("action={null}（しおり・ToDo・精算は主ボタンを出さない）", () => {
  it("主ボタンを出さず、タブは5つのまま", () => {
    render(<TripTabBar tripId={tripId} current="settlement" action={null} />);
    expect(screen.queryByText("支払いを記録")).toBeNull();
    const nav = screen.getByRole("navigation", { name: "タブ" });
    expect(within(nav).getAllByRole("link")).toHaveLength(4);
  });

  it("オフラインでも主ボタンを出さない", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    render(<TripTabBar tripId={tripId} current="itinerary" action={null} />);
    expect(screen.queryByText("支払いを記録")).toBeNull();
  });

  it("画面が指定した主ボタンだけを出し、「支払いを記録」は並べない", () => {
    render(
      <TripTabBar
        tripId={tripId}
        current="itinerary"
        action={{ label: "達成を記録", icon: null, onPress: () => {} }}
      />,
    );
    expect(
      screen.getByRole("button", { name: "達成を記録" }),
    ).toHaveClass("main-action");
    expect(screen.queryByText("支払いを記録")).toBeNull();
  });
});
