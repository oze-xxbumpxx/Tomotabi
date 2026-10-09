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

/** navigator.serviceWorkerを立ててブラウザの購読の解除を見る（PW-10）。 */
function stubServiceWorkerWithSubscription() {
  const unsubscribe = vi
    .fn<() => Promise<boolean>>()
    .mockResolvedValue(true);
  const subscription = { unsubscribe };
  const registration = {
    pushManager: {
      getSubscription: vi.fn(() => Promise.resolve(subscription)),
    },
  };
  Object.defineProperty(window.navigator, "serviceWorker", {
    value: {
      getRegistration: vi.fn(() => Promise.resolve(registration)),
    },
    configurable: true,
    writable: true,
  });
  return { unsubscribe };
}

afterEach(() => {
  vi.clearAllMocks();
  delete (window.navigator as { serviceWorker?: unknown }).serviceWorker;
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
      const signOutResult = await result.current.signOut(userId);
      ok = signOutResult.ok;
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
      const signOutResult = await result.current.signOut(userId);
      ok = signOutResult.ok;
    });

    expect(ok).toBe(false);
    expect(result.current.failed).toBe(true);
    expect(window.localStorage.getItem(selectedKey)).not.toBeNull();
  });

  it("PW-10: ブラウザの購読を解除してからサインアウトする", async () => {
    const { unsubscribe } = stubServiceWorkerWithSubscription();
    signOutMock.mockResolvedValue({ data: { success: true }, error: null });

    const { result } = renderHook(() => useSignOut());
    await act(async () => {
      await result.current.signOut(userId);
    });

    expect(unsubscribe).toHaveBeenCalled();
    expect(signOutMock).toHaveBeenCalled();
  });

  it("PW-10: ブラウザの解除に失敗してもログアウトは続ける", async () => {
    const unsubscribe = vi
      .fn<() => Promise<boolean>>()
      .mockRejectedValue(new Error("offline"));
    const registration = {
      pushManager: {
        getSubscription: vi.fn(() =>
          Promise.resolve({ unsubscribe }),
        ),
      },
    };
    Object.defineProperty(window.navigator, "serviceWorker", {
      value: {
        getRegistration: vi.fn(() => Promise.resolve(registration)),
      },
      configurable: true,
      writable: true,
    });
    signOutMock.mockResolvedValue({ data: { success: true }, error: null });

    const { result } = renderHook(() => useSignOut());
    let ok = false;
    await act(async () => {
      ok = (await result.current.signOut(userId)).ok;
    });
    expect(ok).toBe(true);
  });

  it("PW-10: 503ならログアウトせずpush-stopの失敗にする", async () => {
    signOutMock.mockResolvedValue({
      data: null,
      error: { status: 503 },
    });

    const { result } = renderHook(() => useSignOut());
    let ok = true;
    await act(async () => {
      ok = (await result.current.signOut(userId)).ok;
    });
    expect(ok).toBe(false);
    expect(result.current.failure).toBe("push-stop");
  });

  it("PW-10: X-Push-StoppedがfalseならpushStopped=falseを返す", async () => {
    signOutMock.mockImplementation(
      (options?: {
        fetchOptions?: { onResponse?: (ctx: { response: Response }) => void };
      }) => {
        options?.fetchOptions?.onResponse?.({
          response: new Response(null, {
            status: 200,
            headers: { "x-push-stopped": "false" },
          }),
        });
        return Promise.resolve({ data: { success: true }, error: null });
      },
    );

    const { result } = renderHook(() => useSignOut());
    let pushStopped: boolean | null = null;
    await act(async () => {
      const signOutResult = await result.current.signOut(userId);
      if (signOutResult.ok) {
        pushStopped = signOutResult.pushStopped;
      }
    });
    expect(pushStopped).toBe(false);
  });
});
