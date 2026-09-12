import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProbePanel } from "@/features/foundation";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ProbePanel", () => {
  it("shows the probe count from the API", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({ count: 3 }),
      }),
    );

    render(<ProbePanel />);
    expect(await screen.findByText("現在の件数: 3")).toBeInTheDocument();
  });

  it("shows an error when the API is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Failed to fetch")),
    );

    render(<ProbePanel />);
    expect(await screen.findByText("Failed to fetch")).toBeInTheDocument();
  });

  it("increments after a successful click", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ count: 1 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ count: 2 }),
      });
    vi.stubGlobal("fetch", fetchMock);

    render(<ProbePanel />);
    expect(await screen.findByText("現在の件数: 1")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "1 加算する" }));
    expect(await screen.findByText("現在の件数: 2")).toBeInTheDocument();
  });
});
