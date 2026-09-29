import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { signOutMock } = vi.hoisted(() => ({
  signOutMock: vi.fn(),
}));

vi.mock("@/shared/auth/auth-client", () => ({
  authClient: { signOut: signOutMock },
}));

import { useSignOut } from "@/features/auth";

const userId = "550e8400-e29b-41d4-a716-446655440000";
const selectedKey = `tomotabi:selected-trip:${userId}`;

afterEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe("useSignOut", () => {
  it("W-04: 成功したらその利用者の保存値（前回の旅行）を消す", async () => {
    signOutMock.mockResolvedValue({ data: { success: true }, error: null });
    window.localStorage.setItem(
      selectedKey,
      "8a6e0804-2bd0-4672-b79d-d97027f9071a",
    );

    const { result } = renderHook(() => useSignOut());

    let ok = false;
    await act(async () => {
      ok = await result.current.signOut(userId);
    });

    expect(ok).toBe(true);
    expect(window.localStorage.getItem(selectedKey)).toBeNull();
  });

  it("失敗したら保存値を残す", async () => {
    signOutMock.mockResolvedValue({
      data: null,
      error: { status: 503 },
    });
    window.localStorage.setItem(
      selectedKey,
      "8a6e0804-2bd0-4672-b79d-d97027f9071a",
    );

    const { result } = renderHook(() => useSignOut());

    let ok = true;
    await act(async () => {
      ok = await result.current.signOut(userId);
    });

    expect(ok).toBe(false);
    expect(result.current.failed).toBe(true);
    expect(window.localStorage.getItem(selectedKey)).not.toBeNull();
  });
});
