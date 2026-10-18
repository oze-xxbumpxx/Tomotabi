import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HomeSkeleton } from "@/screens/home/home-skeleton";
import { ItinerarySkeleton } from "@/screens/itinerary/itinerary-skeleton";
import { RecordListSkeleton } from "@/screens/records/records-skeleton";
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
