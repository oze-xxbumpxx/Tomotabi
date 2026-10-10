import "fake-indexeddb/auto";
import {
  act,
  cleanup,
  render,
  renderHook,
  screen,
  waitFor,
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
  NEW_TRIP_ID,
  pendingRequestToMutation,
  savePendingRequest,
  toPendingRequestRecord,
  type PendingRequestRecord,
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
// 経路は送り直しの許可リストにある支払いの書き込みのものを使う。
const OPERATION = "test-payment-record";
const TEST_URL = `/api/trips/${TRIP_ID}/payments`;
const DAY_MS = 24 * 60 * 60 * 1000;

function failSend(failure: ApiFailure): Send {
  return () => errAsync<ApiSuccess<Data>, ApiFailure>(failure);
}

function okSend(data: Data): Send {
  return () =>
    okAsync<ApiSuccess<Data>, ApiFailure>({ data, status: 201, etag: null });
}

function makeRecord(
  overrides: Partial<PendingRequestRecord> = {},
): PendingRequestRecord {
  const request = createMutationRequest({
    operation: OPERATION,
    url: TEST_URL,
    method: "POST",
    body: { amount: "7001" },
  });
  return {
    ...toPendingRequestRecord({ userId: USER_ID, tripId: TRIP_ID, request }),
    ...overrides,
  };
}

async function findKept() {
  const lookup = await findPendingRequest({
    userId: USER_ID,
    tripId: TRIP_ID,
    operation: OPERATION,
  });
  return lookup.status === "found" ? lookup.record : null;
}

async function resetDb(): Promise<void> {
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase("tomotabi");
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

async function waitForCheckStatus(status: string) {
  await waitFor(() =>
    expect(screen.getByTestId("check-status")).toHaveTextContent(status),
  );
}

/**
 * 結果不明の要求をIndexedDBに残す操作の試験用フォーム。
 * 支払い・精算の画面ができるまで、この形で保存の流れを通す。
 * `check`を`useSaveState`に渡しているので、保留がある・確認中・
 * 確認できないあいだは「保存」（新しいキーでの送信）は受け付けない。
 */
function FinanceForm({ send, userId }: { send: Send; userId: string }) {
  const { check, reload } = usePendingRequestCheck({
    userId,
    tripId: TRIP_ID,
    operation: OPERATION,
  });
  const { state, submit, confirmWithSameRequest, confirmRequest } =
    useSaveState<Data, Data>({
      send,
      pendingRequest: { userId, tripId: TRIP_ID, check },
    });
  const [memo, setMemo] = useState("");

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit({
          operation: OPERATION,
          url: TEST_URL,
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
      <span data-testid="check-status">{check.status}</span>
      {state.status === "editing" && check.status === "found" ? (
        <SaveUnknown
          onConfirm={() => void confirmRequest(check.record).then(reload)}
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
    const send = vi.fn(okSend({ id: "pay-1" }));
    const user = userEvent.setup();
    render(<FinanceForm send={send} userId={USER_ID} />);
    await waitForCheckStatus("none");

    // 保留の確認が通ったあとで、送る直前の書き込みだけ失敗させる。
    const putSpy = vi
      .spyOn(IDBObjectStore.prototype, "put")
      .mockImplementation(() => {
        throw new DOMException("writes blocked", "InvalidStateError");
      });
    try {
      await user.click(screen.getByRole("button", { name: "保存" }));

      expect(
        await screen.findByText(
          "この端末では保存の確認に使う領域が使えません",
        ),
      ).toBeInTheDocument();
      expect(send).not.toHaveBeenCalled();
    } finally {
      putSpy.mockRestore();
    }
  });

  it("IndexedDB が読めないあいだは保存を受け付けずに案内を出す", async () => {
    vi.stubGlobal("indexedDB", undefined);
    const send = vi.fn(okSend({ id: "pay-1" }));
    const user = userEvent.setup();
    render(<FinanceForm send={send} userId={USER_ID} />);
    await waitForCheckStatus("unavailable");

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
    await waitForCheckStatus("none");

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
    await waitForCheckStatus("none");

    await user.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByText("保存できませんでした");

    expect(await findKept()).toBeNull();
  });

  it("競合（409）を受けたら保留を消す", async () => {
    const send = vi.fn(
      failSend({ kind: "http", status: 409, code: "VERSION_CONFLICT" }),
    );
    const user = userEvent.setup();
    render(<FinanceForm send={send} userId={USER_ID} />);
    await waitForCheckStatus("none");

    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(send).toHaveBeenCalled());

    await waitFor(async () => {
      expect(await findKept()).toBeNull();
    });
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
    await waitForCheckStatus("none");
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
    await waitForCheckStatus("none");
    await user.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByText("もう一度ログインしてください");
    expect(await findKept()).not.toBeNull();
  });

  it("FW-09: 結果不明のあと再読み込みすると、同じ利用者だけ「同じ内容で確認する」が出て、本人の操作で同じ要求を送る", async () => {
    const user = userEvent.setup();

    // 再読み込み前: networkで結果不明 → 保留が残る。
    const first = render(
      <FinanceForm send={vi.fn(failSend({ kind: "network" }))} userId={USER_ID} />,
    );
    await waitForCheckStatus("none");
    await user.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByText("保存されたか確認できません");
    const kept = await findKept();
    if (kept === null) {
      throw new Error("pending request was not kept");
    }
    first.unmount();

    // 別の利用者の保留としては見つからない（内容も見せない）。
    const otherLookup = await findPendingRequest({
      userId: OTHER_USER_ID,
      tripId: TRIP_ID,
      operation: OPERATION,
    });
    expect(otherLookup.status).toBe("none");

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

  it("再読み込み後に保留が残っているあいだは新しいキーで保存せず、同じ内容で確かめるだけ送る", async () => {
    const user = userEvent.setup();

    // networkで結果不明 → 保留が残る → 再読み込み相当でアンマウント。
    const first = render(
      <FinanceForm send={vi.fn(failSend({ kind: "network" }))} userId={USER_ID} />,
    );
    await waitForCheckStatus("none");
    await user.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByText("保存されたか確認できません");
    const kept = await findKept();
    if (kept === null) {
      throw new Error("pending request was not kept");
    }
    first.unmount();

    const send = vi.fn(okSend({ id: "pay-1" }));
    render(<FinanceForm send={send} userId={USER_ID} />);
    await screen.findByRole("button", { name: "同じ内容で確認する" });

    // 保留があるあいだは「保存」を押しても新しいキーで送らない。
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(send).not.toHaveBeenCalled();
    expect(await listPendingRequestsForUser(USER_ID)).toHaveLength(1);

    // 「同じ内容で確認する」は同じキーで1回だけ送る。
    await user.click(
      screen.getByRole("button", { name: "同じ内容で確認する" }),
    );
    await screen.findByText("保存しました");
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].idempotencyKey).toBe(kept.idempotencyKey);
    expect(await findKept()).toBeNull();
  });

  it("FW-11: 保留の中身に Cookie・トークン・未送信の入力は入っていない", async () => {
    const send = vi.fn(failSend({ kind: "network" }));
    const user = userEvent.setup();
    render(<FinanceForm send={send} userId={USER_ID} />);
    await waitForCheckStatus("none");

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

describe("読み出した保留の検証", () => {
  const tamperedCases: {
    name: string;
    record: () => PendingRequestRecord;
  }[] = [
    {
      name: "外部のオリジンを向く url",
      record: () =>
        makeRecord({
          url: `https://evil.example.com/api/trips/${TRIP_ID}/${OPERATION}`,
        }),
    },
    {
      name: "// で始まる url",
      record: () =>
        makeRecord({
          url: `//evil.example.com/api/trips/${TRIP_ID}/${OPERATION}`,
        }),
    },
    {
      name: "別の旅行を向く url",
      record: () => makeRecord({ url: `/api/trips/other-trip/payments` }),
    },
    {
      name: "許可リストに無い経路の url",
      record: () => makeRecord({ url: `/api/trips/${TRIP_ID}/members` }),
    },
    {
      name: "GET の method",
      record: () =>
        makeRecord({ method: "GET" as PendingRequestRecord["method"] }),
    },
    {
      name: "UUID でない冪等キー",
      record: () => makeRecord({ idempotencyKey: "not-a-uuid", id: "not-a-uuid" }),
    },
    {
      name: "JSON として読めない bodyJson",
      record: () => makeRecord({ bodyJson: "{not json" }),
    },
    // RU-07: 新しく足した経路と、`new-trip` の特例の外れの確認。
    {
      name: "tripId が旅行なのに `/api/trips` ちょうどの url",
      record: () => makeRecord({ url: "/api/trips" }),
    },
    {
      name: "UUID でない予定のレコードを向く url",
      record: () =>
        makeRecord({ url: `/api/trips/${TRIP_ID}/plans/not-a-uuid` }),
    },
    {
      name: "UUID でない達成のレコードを向く url",
      record: () =>
        makeRecord({
          url: `/api/trips/${TRIP_ID}/achievements/not-a-uuid/cancel`,
        }),
    },
    {
      name: "許可済み経路の後ろに余計な段がある url",
      record: () =>
        makeRecord({
          url: `/api/trips/${TRIP_ID}/plans/${crypto.randomUUID()}/move/extra`,
        }),
    },
    {
      name: "tripId の文字列が途中で終わる url",
      record: () =>
        makeRecord({ url: `/api/trips/${TRIP_ID}evil/payments` }),
    },
  ];

  for (const { name, record } of tamperedCases) {
    it(`${name} の保留は送らずに消し、確かめられない案内を出す`, async () => {
      const send = vi.fn(okSend({ id: "pay-1" }));
      await savePendingRequest(record());
      const user = userEvent.setup();
      render(<FinanceForm send={send} userId={USER_ID} />);

      // 「この保存は確かめられません」の扱い（storage-unavailableと同じ案内）。
      expect(
        await screen.findByText(
          "この端末では保存の確認に使う領域が使えません",
        ),
      ).toBeInTheDocument();
      await waitFor(async () => {
        expect(await listPendingRequestsForUser(USER_ID)).toEqual([]);
      });
      expect(send).not.toHaveBeenCalled();

      // そのあと「保存」を押しても新しいキーで送らない。
      await user.click(screen.getByRole("button", { name: "保存" }));
      expect(send).not.toHaveBeenCalled();
      expect(await listPendingRequestsForUser(USER_ID)).toEqual([]);
    });
  }

  it("許可リストの経路と形が合う保留は送り直せる形に戻る", () => {
    const allowed: { operation: string; url: string }[] = [
      { operation: "record-payment", url: `/api/trips/${TRIP_ID}/payments` },
      {
        operation: "cancel-payment",
        url: `/api/trips/${TRIP_ID}/payments/${crypto.randomUUID()}/cancel`,
      },
      {
        operation: "create-settlement-preview",
        url: `/api/trips/${TRIP_ID}/settlement-previews`,
      },
      {
        operation: "complete-settlement",
        url: `/api/trips/${TRIP_ID}/settlements`,
      },
      {
        operation: "cancel-settlement",
        url: `/api/trips/${TRIP_ID}/settlements/${crypto.randomUUID()}/cancel`,
      },
      // 旅行の書き込み（Issue #142）。
      { operation: "rename-trip", url: `/api/trips/${TRIP_ID}` },
      {
        operation: "update-trip-period",
        url: `/api/trips/${TRIP_ID}/period`,
      },
      { operation: "start-trip", url: `/api/trips/${TRIP_ID}/start` },
      { operation: "finish-trip", url: `/api/trips/${TRIP_ID}/finish` },
      // 予定の書き込み（Issue #142）。
      { operation: "create-plan", url: `/api/trips/${TRIP_ID}/plans` },
      {
        operation: "update-plan",
        url: `/api/trips/${TRIP_ID}/plans/${crypto.randomUUID()}`,
      },
      {
        operation: "move-plan",
        url: `/api/trips/${TRIP_ID}/plans/${crypto.randomUUID()}/move`,
      },
      {
        operation: "cancel-plan",
        url: `/api/trips/${TRIP_ID}/plans/${crypto.randomUUID()}/cancel`,
      },
      // 達成・予約の書き込み（Issue #142）。
      {
        operation: "record-achievement",
        url: `/api/trips/${TRIP_ID}/achievements`,
      },
      {
        operation: "cancel-achievement",
        url: `/api/trips/${TRIP_ID}/achievements/${crypto.randomUUID()}/cancel`,
      },
      {
        operation: "record-booking",
        url: `/api/trips/${TRIP_ID}/bookings`,
      },
      {
        operation: "cancel-booking",
        url: `/api/trips/${TRIP_ID}/bookings/${crypto.randomUUID()}/cancel`,
      },
      // 許可済みの経路であれば操作名は許可リストに依らない。
      { operation: OPERATION, url: TEST_URL },
    ];
    for (const { operation, url } of allowed) {
      const request = createMutationRequest({
        operation,
        url,
        method: "POST",
        body: { amount: "7001" },
      });
      const record = toPendingRequestRecord({
        userId: USER_ID,
        tripId: TRIP_ID,
        request,
      });
      const mutation = pendingRequestToMutation(record);
      expect(mutation).not.toBeNull();
      expect(mutation?.url).toBe(url);
      expect(mutation?.idempotencyKey).toBe(record.idempotencyKey);
    }
  });

  it("旅行の新規作成の保留は `new-trip` の tripId で `/api/trips` ちょうどだけを許す", () => {
    // 新規作成は `/api/trips` ちょうどへのPOST。
    const create = pendingRequestToMutation(
      toPendingRequestRecord({
        userId: USER_ID,
        tripId: NEW_TRIP_ID,
        request: createMutationRequest({
          operation: "create-trip",
          url: "/api/trips",
          method: "POST",
          body: { name: "旅" },
        }),
      }),
    );
    expect(create).not.toBeNull();
    expect(create?.url).toBe("/api/trips");

    // `new-trip` ではほかの経路を送り直せない（旅行が決まったように
    // 見せた経路も、末尾に余計な / があるものも）。
    const rejectedUrls = [
      `/api/trips/${TRIP_ID}`,
      `/api/trips/${TRIP_ID}/plans`,
      "/api/trips/",
      "/api/trips?next=/trips",
      "/api/admin/trips",
    ];
    for (const url of rejectedUrls) {
      const record = toPendingRequestRecord({
        userId: USER_ID,
        tripId: NEW_TRIP_ID,
        request: createMutationRequest({
          operation: "create-trip",
          url,
          method: "POST",
          body: { name: "旅" },
        }),
      });
      expect(
        pendingRequestToMutation(record),
        `${url} は送り直せないはず`,
      ).toBeNull();
    }

    // 旅行の tripId では `/api/trips` ちょうどは（新規作成に見せかけて）
    // 送り直せない。
    const tripRecord = toPendingRequestRecord({
      userId: USER_ID,
      tripId: TRIP_ID,
      request: createMutationRequest({
        operation: "create-trip",
        url: "/api/trips",
        method: "POST",
        body: { name: "旅" },
      }),
    });
    expect(pendingRequestToMutation(tripRecord)).toBeNull();
  });

  it("`new-trip` の形が確かめられない保留は読み出しで消し、確かめられない扱いにする", async () => {
    // `/api/trips` ちょうど以外の url（末尾に余計な / があるものも）は
    // 読み出しの検証で落とし、送り直せる形としては返さない。
    for (const url of [`/api/trips/${TRIP_ID}/plans`, "/api/trips/"]) {
      await savePendingRequest(
        toPendingRequestRecord({
          userId: USER_ID,
          tripId: NEW_TRIP_ID,
          request: createMutationRequest({
            operation: "create-trip",
            url,
            method: "POST",
            body: { name: "旅" },
          }),
        }),
      );
      const lookup = await findPendingRequest({
        userId: USER_ID,
        tripId: NEW_TRIP_ID,
        operation: "create-trip",
      });
      expect(lookup.status, `${url} は確かめられないはず`).toBe("invalid");
    }
    expect(await listPendingRequestsForUser(USER_ID)).toEqual([]);
  });

  it("確かめ直しの要求が今の利用者・旅行と合わなければ送らずに消す", async () => {
    const send = vi.fn(okSend({ id: "pay-1" }));
    const { result } = renderHook(() =>
      useSaveState<Data, Data>({
        send,
        pendingRequest: {
          userId: USER_ID,
          tripId: TRIP_ID,
          check: { status: "none" },
        },
      }),
    );

    // 別の利用者の保留。
    const otherUserRecord = makeRecord({ userId: OTHER_USER_ID });
    await savePendingRequest(otherUserRecord);
    // 別の旅行の保留（urlはその保留のtripIdに合わせる）。
    const otherTripRequest = createMutationRequest({
      operation: OPERATION,
      url: `/api/trips/trip-2/payments`,
      method: "POST",
      body: { amount: "7001" },
    });
    const otherTripRecord = toPendingRequestRecord({
      userId: USER_ID,
      tripId: "trip-2",
      request: otherTripRequest,
    });
    await savePendingRequest(otherTripRecord);

    await act(async () => {
      await result.current.confirmRequest(otherUserRecord);
    });
    expect(send).not.toHaveBeenCalled();
    expect(
      (
        await findPendingRequest({
          userId: OTHER_USER_ID,
          tripId: TRIP_ID,
          operation: OPERATION,
        })
      ).status,
    ).toBe("none");

    await act(async () => {
      await result.current.confirmRequest(otherTripRecord);
    });
    expect(send).not.toHaveBeenCalled();
    expect(
      (
        await findPendingRequest({
          userId: USER_ID,
          tripId: "trip-2",
          operation: OPERATION,
        })
      ).status,
    ).toBe("none");
  });

  it("確かめ直しで形が合わない保留は送らずに消し、確かめられない扱いにする", async () => {
    const send = vi.fn(okSend({ id: "pay-1" }));
    const { result } = renderHook(() =>
      useSaveState<Data, Data>({
        send,
        pendingRequest: {
          userId: USER_ID,
          tripId: TRIP_ID,
          check: { status: "none" },
        },
      }),
    );
    const broken = makeRecord({ method: "GET" as PendingRequestRecord["method"] });
    await savePendingRequest(broken);

    await act(async () => {
      await result.current.confirmRequest(broken);
    });

    expect(send).not.toHaveBeenCalled();
    expect(result.current.state.status).toBe("storage-unavailable");
    expect(await listPendingRequestsForUser(USER_ID)).toEqual([]);
  });
});

describe("保持期間と他の利用者の掃除", () => {
  it("createdAt から 7 日を超えた保留は読むときに消して返さず、期間内のものは見つかる", async () => {
    const expired = makeRecord({
      createdAt: new Date(Date.now() - 8 * DAY_MS).toISOString(),
    });
    const fresh = makeRecord();
    await savePendingRequest(expired);
    await savePendingRequest(fresh);

    const lookup = await findPendingRequest({
      userId: USER_ID,
      tripId: TRIP_ID,
      operation: OPERATION,
    });
    expect(lookup.status).toBe("found");
    if (lookup.status === "found") {
      expect(lookup.record.id).toBe(fresh.id);
    }
    expect(await listPendingRequestsForUser(USER_ID)).toHaveLength(1);
  });

  it("同じ操作に保留が複数あるときは新しいもの（createdAt の大きいもの）を返す", async () => {
    const older = makeRecord({
      createdAt: new Date(Date.now() - DAY_MS).toISOString(),
    });
    const newer = makeRecord();
    await savePendingRequest(older);
    await savePendingRequest(newer);

    const lookup = await findPendingRequest({
      userId: USER_ID,
      tripId: TRIP_ID,
      operation: OPERATION,
    });
    expect(lookup.status).toBe("found");
    if (lookup.status === "found") {
      expect(lookup.record.id).toBe(newer.id);
    }
  });

  it("サインインした利用者以外の保留は、利用者が分かったときに消す", async () => {
    await savePendingRequest(makeRecord());
    await savePendingRequest(makeRecord({ userId: OTHER_USER_ID }));

    render(<PendingOnly userId={USER_ID} />);
    await screen.findByText(/7001/);

    expect(await listPendingRequestsForUser(OTHER_USER_ID)).toEqual([]);
    expect(await listPendingRequestsForUser(USER_ID)).toHaveLength(1);
  });

  it("利用者が分かるまでは IndexedDB を読まず checking のままにする", async () => {
    const openSpy = vi.spyOn(indexedDB, "open");
    try {
      const { result, rerender } = renderHook(
        ({ userId }: { userId: string | null }) =>
          usePendingRequestCheck({
            userId,
            tripId: TRIP_ID,
            operation: OPERATION,
          }),
        { initialProps: { userId: null as string | null } },
      );
      await act(async () => {});

      expect(result.current.check.status).toBe("checking");
      expect(openSpy).not.toHaveBeenCalled();

      rerender({ userId: USER_ID });
      await waitFor(() =>
        expect(result.current.check.status).toBe("none"),
      );
      expect(openSpy).toHaveBeenCalled();
    } finally {
      openSpy.mockRestore();
    }
  });

  it("同じキーでの確かめ直しでは createdAt を最初の値のままにする", async () => {
    const originalCreatedAt = new Date(
      Date.now() - DAY_MS,
    ).toISOString();
    await savePendingRequest(makeRecord({ createdAt: originalCreatedAt }));

    const send = vi.fn(failSend({ kind: "network" }));
    const user = userEvent.setup();
    render(<FinanceForm send={send} userId={USER_ID} />);
    await user.click(
      await screen.findByRole("button", { name: "同じ内容で確認する" }),
    );
    await screen.findByText("保存されたか確認できません");

    const kept = await findKept();
    if (kept === null) {
      throw new Error("pending request was not kept");
    }
    expect(kept.createdAt).toBe(originalCreatedAt);
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
      expect((await result.current.signOut(USER_ID)).ok).toBe(true);
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
      expect((await result.current.signOut(USER_ID)).ok).toBe(false);
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
