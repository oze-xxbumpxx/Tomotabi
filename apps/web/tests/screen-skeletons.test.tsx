import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HomeSkeleton, scheduleExpectedFor } from "@/screens/home/home-skeleton";
import { ItinerarySkeleton } from "@/screens/itinerary/itinerary-skeleton";
import { RecordListSkeleton, RecordsPageSkeleton } from "@/screens/records/records-skeleton";
import { SettlementSkeleton } from "@/screens/settlement/settlement-skeleton";

afterEach(() => {
  cleanup();
});

// 本物の画面と同じ外側の要素とクラス名を使うことで、読み込み後に形が動かない（SS-T01）。
describe("4画面の骨組み（SS-T01）", () => {
  it.each([
    ["ホーム", <HomeSkeleton key="h" />, "MAIN", "home-page", [".home-header", ".home-bars", ".home-card", ".home-settle"]],
    ["しおり", <ItinerarySkeleton key="i" />, "MAIN", "itinerary-page", [".trip-header", ".date-bar", ".itinerary-list"]],
    ["記録", <RecordListSkeleton key="r" />, "SECTION", "record-card", []],
    ["精算", <SettlementSkeleton key="s" />, "MAIN", "settle-page", [".settle-card"]],
  ] as const)("%s: 読み込み中と伝え、本物と同じ外枠を使う", (_name, element, tag, className, inner) => {
    render(element);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("読み込み中");
    expect(status.tagName).toBe(tag);
    expect(status).toHaveClass(className);
    for (const selector of inner) {
      expect(status.querySelector(selector)).not.toBeNull();
    }
    expect(status.querySelectorAll(".skeleton").length).toBeGreaterThan(0);
  });
});

describe("ホームの骨組みの予定のカード", () => {
  it.each([
    ["旅行がキャッシュに無い", null, true],
    ["旅行中で期間内", { status: "traveling", endsOn: "2026-10-20" }, true],
    ["計画中で期間前", { status: "planning", endsOn: "2026-10-20" }, true],
    ["終了した", { status: "finished", endsOn: "2026-10-20" }, false],
    ["期間を過ぎた", { status: "traveling", endsOn: "2026-10-17" }, false],
  ] as const)("%s → %s", (_name, trip, expected) => {
    expect(scheduleExpectedFor(trip, "2026-10-18")).toBe(expected);
  });

  it("予定のカードを出さないときは、精算のカードがヘッダーの次に来る", () => {
    render(<HomeSkeleton showSchedule={false} />);
    const status = screen.getByRole("status");
    expect(status.querySelector(".home-bars + .home-settle")).not.toBeNull();
  });
});

describe("記録の画面全体の骨組み", () => {
  it("見出し・絞り込み・一覧の骨組みの順に並ぶ", () => {
    render(<RecordsPageSkeleton />);
    expect(screen.getByRole("heading", { name: "記録" })).toBeInTheDocument();
    const main = screen.getByRole("main");
    expect(main.querySelector(".page-title + .record-filters + .record-card")).not.toBeNull();
  });
});
