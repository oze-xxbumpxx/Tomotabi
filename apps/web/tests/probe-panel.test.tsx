import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProbePanel } from "@/features/foundation";
import { useProbe } from "@/features/foundation/model/use-probe";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function json(body: unknown): Response {
  return new Response(JSON.stringify(body));
}

describe("ProbePanel", () => {
  it("shows the probe count from the API", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ count: 4 })));

    render(<ProbePanel />);
    expect(await screen.findByText("現在の件数: 4")).toBeInTheDocument();
  });

  it("shows a network error instead of a zero count", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    render(<ProbePanel />);
    expect(await screen.findByText("通信できませんでした")).toBeInTheDocument();
    expect(screen.queryByText("現在の件数: 0")).not.toBeInTheDocument();
  });

  it("increments after a successful click", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(json({ count: 4 })).mockResolvedValueOnce(json({ count: 5 })),
    );

    render(<ProbePanel />);
    expect(await screen.findByText("現在の件数: 4")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "1 加算する" }));
    expect(await screen.findByText("現在の件数: 5")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1 加算する" })).toBeEnabled();
  });
});

describe("useProbe", () => {
  it("keeps the previous count and releases pending when an increment fails validation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(json({ count: 4 })).mockResolvedValueOnce(json({ count: -1 })),
    );

    const { result } = renderHook(() => useProbe());
    await waitFor(() => expect(result.current.count).toBe(4));

    await act(() => result.current.increment());

    expect(result.current.count).toBe(4);
    expect(result.current.error).toBe("サーバーの応答を読み取れませんでした");
    expect(result.current.pending).toBe(false);
  });
});
