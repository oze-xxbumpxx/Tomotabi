import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useNow } from "@/shared/lib/use-now";

function Clock() {
  const now = useNow();
  return <span>{now === null ? "none" : now.toISOString()}</span>;
}

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    value: state,
    configurable: true,
  });
}

afterEach(() => {
  cleanup();
  setVisibility("visible");
  vi.useRealTimers();
});

describe("useNow（1 分ごとの現在時刻）", () => {
  it("マウントで現在時刻を出し、1 分ごとに更新する", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-13T00:41:00.000Z"));
    render(<Clock />);

    expect(
      screen.getByText("2026-10-13T00:41:00.000Z"),
    ).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(
      screen.getByText("2026-10-13T00:42:00.000Z"),
    ).toBeInTheDocument();
  });

  it("タブが裏のあいだは更新せず、表に戻ると最新に進む", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-13T00:41:00.000Z"));
    render(<Clock />);
    expect(
      screen.getByText("2026-10-13T00:41:00.000Z"),
    ).toBeInTheDocument();

    setVisibility("hidden");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    act(() => {
      vi.advanceTimersByTime(5 * 60_000);
    });
    // 裏のあいだは表示が進まない。
    expect(
      screen.getByText("2026-10-13T00:41:00.000Z"),
    ).toBeInTheDocument();

    setVisibility("visible");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    // 表に戻った時点で最新に進む（裏で進んだ5分を反映）。
    expect(
      screen.getByText("2026-10-13T00:46:00.000Z"),
    ).toBeInTheDocument();
  });
});
