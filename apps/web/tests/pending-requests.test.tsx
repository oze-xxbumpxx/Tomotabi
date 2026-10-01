import "fake-indexeddb/auto";
import {
  act,
  cleanup,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { errAsync, okAsync, type ResultAsync } from "neverthrow";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiFailure } from "@/shared/api/api-failure";
import type { ApiSuccess } from "@/shared/api/api-result";
import {
  createMutationRequest,
  type MutationRequest,
} from "@/shared/api/mutation-request";
import { useSaveState } from "@/shared/api/save-state";
import {
  findPendingRequest,
  listPendingRequestsForUser,
  pendingRequestToMutation,
  savePendingRequest,
  toPendingRequestRecord,
} from "@/shared/browser/pending-requests";
import { usePendingRequestCheck } from "@/shared/browser/use-pending-request-check";
import { SaveUnknown } from "@/shared/ui/state/save-unknown";
import { StorageUnavailable } from "@/shared/ui/state/storage-unavailable";

const { signOutMock } = vi.hoisted(() => ({ signOutMock: vi.fn() }));
vi.mock("@/shared/auth/auth-client", () => ({
  authClient: { signOut: signOutMock },
}));

import { useSignOut } from "@/features/auth";

type Data = { id: string };
type Send = (
  request: MutationRequest,
) => ResultAsync<ApiSuccess<Data>, ApiFailure>;

const USER_ID = "user-hinata";
const OTHER_USER_ID = "user-aoi";
const TRIP_ID = "trip-1";
// 支払い・精算の操作はまだ無いため、試験用の操作名で確かめる。
const OPERATION = "test-payment-record";

function failSend(failure: ApiFailure): Send {
  return () => errAsync<ApiSuccess<Data>, ApiFailure>(failure);
}

function okSend(data: Data): Send {
  return () =>
    okAsync<ApiSuccess<Data>, ApiFailure>({ data, status: 201, etag: null });
}

async function findKept() {
  return findPendingRequest({
    userId: USER_ID,
    tripId: TRIP_ID,
    operation: OPERATION,
  });
}

async function resetDb(): Promise<void> {
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase("tomotabi");
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

/**
 * 結果不明の要求を IndexedDB に残す操作の試験用フォーム。
 * 支払い・精算の画面ができるまで、この形で保存の流れを通す。
 */
function FinanceForm({ send, userId }: { send: Send; userId: string }) {
  const { state, submit, confirmWithSameRequest, confirmRequest } =
    useSaveState<Data, Data>({
      send,
      pendingRequest: { userId, tripId: TRIP_ID },
    });
  const { check } = usePendingRequestCheck({
    userId,
    tripId: TRIP_ID,
    operation: OPERATION,
  });
  const [memo, setMemo] = useState("");

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit({
          operation: OPERATION,
          url: `/api/trips/${TRIP_ID}/payments`,
          method: "POST",
          body: { amount: "7001" },
        });
      }}
    >
      <label>
        メモ
        <input
          value={memo}
          onChange={(event) => setMemo(event.currentTarget.value)}
        />
      </label>
      {state.status === "editing" && check.status === "found" ? (
        <SaveUnknown
          onConfirm={() =>
            void confirmRequest(pendingRequestToMutation(check.record))
          }
        />
      ) : null}
      {state.status === "unknown" ? (
        <SaveUnknown onConfirm={() => void confirmWithSameRequest()} />
      ) : null}
      {state.status === "storage-unavailable" ||
      check.status === "unavailable" ? (
        <StorageUnavailable />
      ) : null}
      {state.status === "rejected" ? (
        <p role="alert">保存できませんでした</p>
      ) : null}
      {state.status === "session-expired" ? (
        <p role="alert">もう一度ログインしてください</p>
      ) : null}
      {state.status === "succeeded" ? <p>保存しました</p> : null}
      <button type="submit" disabled={state.status === "saving"}>
        保存
      </button>
    </form>
  );
}

function PendingOnly({ userId }: { userId: string }) {
  const { check } = usePendingRequestCheck({
    userId,
    tripId: TRIP_ID,
    operation: OPERATION,
  });
  if (check.status === "found") {
    return <p>{check.record.bodyJson}</p>;
  }
  return <p>保留なし</p>;
}

beforeEach(async () => {
  await resetDb();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("保留中の要求（IndexedDB）", () => {
  it("FW-08: 送る前の保存が失敗したら送らずに止めて案内を出す", async () => {
    vi.stubGlobal("indexedDB", undefined);
    const send = vi.fn(okSend({ id: "pay-1" }));
    const user = userEvent.setup();
    render(<FinanceForm send={send} userId={USER_ID} />);

    await user.click(screen.getByRole("button", { name: "保存" }));

    expect(
      await screen.findByText(
        "この端末では保存の確認に使う領域が使えません",
      ),
    ).toBeInTheDocument();
    expect(send).not.toHaveBeenCalled();
  });

  it("成功したら保留を消す", async () => {
    const send = vi.fn(okSend({ id: "pay-1" }));
    const user = userEvent.setup();
    render(<FinanceForm send={send} userId={USER_ID} />);

    await user.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByText("保存しました");

    expect(await findKept()).toBeNull();
  });

  it("確定した拒否を受けたら保留を消す", async () => {
    const send = vi.fn(
      failSend({ kind: "http", status: 422, code: "VALIDATION_FAILED" }),
    );
    const user = userEvent.setup();
    render(<FinanceForm send={send} userId={USER_ID} />);

    await user.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByText("保存できませんでした");

    expect(await findKept()).toBeNull();
  });

  it("結果不明（network・5xx）と認証期限切れでは保留を残す", async () => {
    const user = userEvent.setup();

    const unknown = render(
      <FinanceForm
        send={vi.fn(
          failSend({ kind: "http", status: 503, code: "TEMPORARILY_UNAVAILABLE" }),
        )}
        userId={USER_ID}
      />,
    );
    await user.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByText("保存されたか確認できません");
    expect(await findKept()).not.toBeNull();
    unknown.unmount();
    await resetDb();

    render(
      <FinanceForm
        send={vi.fn(
          failSend({ kind: "http", status: 401, code: "UNAUTHENTICATED" }),
        )}
        userId={USER_ID}
      />,
    );
    await user.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByText("もう一度ログインしてください");
    expect(await findKept()).not.toBeNull();
  });

  it("FW-09: 結果不明のあと再読み込みすると、同じ利用者だけ「同じ内容で確認する」が出て、本人の操作で同じ要求を送る", async () => {
    const user = userEvent.setup();

    // 再読み込み前: network で結果不明 → 保留が残る。
    const first = render(
      <FinanceForm send={vi.fn(failSend({ kind: "network" }))} userId={USER_ID} />,
    );
    await user.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByText("保存されたか確認できません");
    const kept = await findKept();
    if (kept === null) {
      throw new Error("pending request was not kept");
    }
    first.unmount();

    // 別の利用者で開くと、保留は出ない（内容も見せない）。
    const other = render(<PendingOnly userId={OTHER_USER_ID} />);
    expect(await screen.findByText("保留なし")).toBeInTheDocument();
    expect(screen.queryByText(/7001/)).not.toBeInTheDocument();
    other.unmount();

    // 同じ利用者で開き直す → 「同じ内容で確認する」は本人の操作でだけ送る。
    const send = vi.fn(okSend({ id: "pay-1" }));
    render(<FinanceForm send={send} userId={USER_ID} />);
    const confirm = await screen.findByRole("button", {
      name: "同じ内容で確認する",
    });
    expect(send).not.toHaveBeenCalled();

    await user.click(confirm);
    await screen.findByText("保存しました");

    expect(send).toHaveBeenCalledTimes(1);
    const resent = send.mock.calls[0][0];
    expect(resent.idempotencyKey).toBe(kept.idempotencyKey);
    expect(resent.bodyJson).toBe(kept.bodyJson);
    expect(resent.url).toBe(kept.url);
    expect(resent.method).toBe(kept.method);
    expect(await findKept()).toBeNull();
  });

  it("FW-11: 保留の中身に Cookie・トークン・未送信の入力は入っていない", async () => {
    const send = vi.fn(failSend({ kind: "network" }));
    const user = userEvent.setup();
    render(<FinanceForm send={send} userId={USER_ID} />);

    await user.type(screen.getByLabelText("メモ"), "未送信の入力 draft-123");
    await user.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByText("保存されたか確認できません");

    const kept = await findKept();
    if (kept === null) {
      throw new Error("pending request was not kept");
    }
    expect(Object.keys(kept).sort()).toEqual(
      [
        "id",
        "userId",
        "tripId",
        "operation",
        "method",
        "url",
        "bodyJson",
        "idempotencyKey",
        "ifMatch",
        "createdAt",
      ].sort(),
    );
    expect(kept.bodyJson).toBe(JSON.stringify({ amount: "7001" }));
    const serialized = JSON.stringify(kept).toLowerCase();
    expect(serialized).not.toContain("cookie");
    expect(serialized).not.toContain("token");
    expect(serialized).not.toContain("draft-123");
  });
});

describe("FW-10: ログアウト", () => {
  it("保留があれば先に知らせ、ログアウトで消す。失敗したら残す", async () => {
    const request = createMutationRequest({
      operation: OPERATION,
      url: `/api/trips/${TRIP_ID}/payments`,
      method: "POST",
      body: { amount: "7001" },
    });
    await savePendingRequest(
      toPendingRequestRecord({ userId: USER_ID, tripId: TRIP_ID, request }),
    );
    const otherRequest = createMutationRequest({
      operation: OPERATION,
      url: `/api/trips/${TRIP_ID}/payments`,
      method: "POST",
      body: { amount: "500" },
    });
    await savePendingRequest(
      toPendingRequestRecord({
        userId: OTHER_USER_ID,
        tripId: TRIP_ID,
        request: otherRequest,
      }),
    );

    signOutMock.mockResolvedValue({ data: { success: true }, error: null });
    const { result } = renderHook(() => useSignOut());

    // 保留があればログアウトの前に分かる（ログアウト自体は止めない）。
    let hasPending = false;
    await act(async () => {
      hasPending = await result.current.checkPendingRequests(USER_ID);
    });
    expect(hasPending).toBe(true);
    expect(result.current.hasPendingRequests).toBe(true);

    await act(async () => {
      expect(await result.current.signOut(USER_ID)).toBe(true);
    });
    expect(await listPendingRequestsForUser(USER_ID)).toEqual([]);
    // 別の利用者の保留は消さない。
    expect(await listPendingRequestsForUser(OTHER_USER_ID)).toHaveLength(1);

    // ログアウトが失敗したら保留は残す。
    await savePendingRequest(
      toPendingRequestRecord({ userId: USER_ID, tripId: TRIP_ID, request }),
    );
    signOutMock.mockResolvedValue({ data: null, error: { status: 503 } });
    await act(async () => {
      expect(await result.current.signOut(USER_ID)).toBe(false);
    });
    expect(await listPendingRequestsForUser(USER_ID)).toHaveLength(1);
  });
});

describe("保存状態の既存の振る舞い（pendingRequest 未指定）", () => {
  it("IndexedDB を触らず、これまでどおり送る", async () => {
    vi.stubGlobal("indexedDB", undefined);
    const send = vi.fn(okSend({ id: "pay-1" }));
    const user = userEvent.setup();

    function TripForm() {
      const { state, submit } = useSaveState<Data, Data>({ send });
      return (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit({
              operation: "rename-trip",
              url: "/api/trips/trip-1",
              method: "PATCH",
              body: { name: "秋の京都" },
            });
          }}
        >
          {state.status === "succeeded" ? <p>保存しました</p> : null}
          <button type="submit">保存</button>
        </form>
      );
    }
    render(<TripForm />);

    await user.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByText("保存しました");

    expect(send).toHaveBeenCalledTimes(1);
  });
});
