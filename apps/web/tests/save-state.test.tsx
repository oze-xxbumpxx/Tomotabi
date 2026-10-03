import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { ApiFailure } from "@/shared/api/api-failure";
import { callApiWithMeta, type ApiSuccess } from "@/shared/api/api-result";
import { httpClient } from "@/shared/api/http-client";
import {
  sendMutationRequest,
  type MutationRequest,
} from "@/shared/api/mutation-request";
import { useSaveState } from "@/shared/api/save-state";
import { Field } from "@/shared/ui/field";
import { ConflictNotice, type ConflictRow } from "@/shared/ui/state/conflict";
import { SaveUnknown } from "@/shared/ui/state/save-unknown";
import { SessionExpired } from "@/shared/ui/state/session-expired";

type TripData = { name: string };

type Send = (
  request: MutationRequest,
) => ResultAsync<ApiSuccess<TripData>, ApiFailure>;
type FetchLatest = () => ResultAsync<ApiSuccess<TripData>, ApiFailure>;

// 設計書の表どおりの出し分けをする、テストだけの小さなフォーム。
function RenameForm({
  send,
  fetchLatest = null,
  initial,
}: {
  send: Send;
  fetchLatest?: FetchLatest | null;
  initial: TripData;
}) {
  const [name, setName] = useState(initial.name);
  const {
    state,
    submit,
    confirmWithSameRequest,
    saveMineOverLatest,
    backToEditing,
  } = useSaveState<TripData, TripData>({ send, fetchLatest });
  const saving = state.status === "saving";
  const locked = saving || state.status === "unknown";

  if (state.status === "session-expired") {
    return (
      <SessionExpired
        unconfirmedTarget={state.unconfirmed ? "旅行" : null}
        onGoToSignIn={() => undefined}
      />
    );
  }

  const conflictRows: ConflictRow[] =
    state.status === "conflict" && state.latest !== null
      ? [
          {
            label: "名前",
            mine: name,
            latest:
              state.latest.data.name === name
                ? null
                : state.latest.data.name,
          },
          { label: "期間", mine: "10/12 – 10/14", latest: null },
        ]
      : [];

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit({
          operation: "rename-trip",
          url: "/api/trips/trip-1",
          method: "PATCH",
          body: { name },
          ifMatch: '"3"',
        });
      }}
    >
      <Field
        label="名前"
        value={name}
        onChange={(event) => setName(event.currentTarget.value)}
        locked={locked}
      />
      {state.status === "rejected" ? (
        <p role="alert">
          {state.code === "VALIDATION_FAILED"
            ? "名前を確認してください"
            : "保存できませんでした"}
        </p>
      ) : null}
      {state.status === "unknown" ? (
        <SaveUnknown onConfirm={() => void confirmWithSameRequest()} />
      ) : null}
      {state.status === "conflict" ? (
        <ConflictNotice
          rows={conflictRows}
          otherName="あおい"
          saving={saving}
          onSaveMine={() => void saveMineOverLatest()}
          onUseLatest={() => {
            if (state.latest !== null) {
              setName(state.latest.data.name);
            }
            backToEditing();
          }}
        />
      ) : null}
      {state.status === "succeeded" ? <p>保存しました</p> : null}
      {state.status !== "unknown" ? (
        <button type="submit" disabled={saving}>
          {saving ? "保存中" : "保存"}
        </button>
      ) : null}
      <button type="button" onClick={backToEditing}>
        編集に戻す
      </button>
    </form>
  );
}

function pendingSend(): Send {
  return () =>
    ResultAsync.fromPromise(
      new Promise<ApiSuccess<TripData>>(() => undefined),
      () => ({ kind: "network" }) as ApiFailure,
    );
}

function failSend(failure: ApiFailure): Send {
  return () => errAsync<ApiSuccess<TripData>, ApiFailure>(failure);
}

function okSend(trip: TripData, etag = '"4"'): Send {
  return () =>
    okAsync<ApiSuccess<TripData>, ApiFailure>({
      data: trip,
      status: 200,
      etag,
    });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const initial: TripData = { name: "秋の京都" };

describe("useSaveState", () => {
  it("W-07: pressing save again while sending sends only one request", async () => {
    const send = vi.fn(pendingSend());
    const user = userEvent.setup();
    render(<RenameForm send={send} initial={initial} />);

    await user.click(screen.getByRole("button", { name: "保存" }));
    await user.click(screen.getByRole("button", { name: "保存中" }));

    expect(send).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "保存中" })).toBeDisabled();
  });

  it("W-08: an unknown result is confirmed by resending the identical request on the wire", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ name: "秋の京都" }), {
          status: 200,
          headers: { ETag: '"4"' },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const send: Send = (request) =>
      sendMutationRequest(request, z.object({ name: z.string() }));
    const user = userEvent.setup();
    render(<RenameForm send={send} initial={initial} />);

    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(
      await screen.findByText("保存されたか確認できません"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("名前")).toHaveAttribute("readonly");

    await user.click(
      screen.getByRole("button", { name: "同じ内容で確認する" }),
    );
    expect(await screen.findByText("保存しました")).toBeInTheDocument();

    // fetchのモックで、1回目と2回目の要求のキー・本文・If-Matchが同じことを確かめる。
    const [first, second] = fetchMock.mock.calls as [
      [string, RequestInit],
      [string, RequestInit],
    ];
    const firstHeaders = new Headers(first[1].headers);
    const secondHeaders = new Headers(second[1].headers);
    expect(secondHeaders.get("idempotency-key")).toBe(
      firstHeaders.get("idempotency-key"),
    );
    expect(second[1].body).toBe(first[1].body);
    expect(secondHeaders.get("if-match")).toBe(firstHeaders.get("if-match"));
    expect(second[0]).toBe(first[0]);
    expect(second[1].method).toBe(first[1].method);
  });

  it("W-09: a 5xx response is also an unknown result (C-4)", async () => {
    const send = vi.fn(
      failSend({ kind: "http", status: 503, code: "TEMPORARILY_UNAVAILABLE" }),
    );
    const user = userEvent.setup();
    render(<RenameForm send={send} initial={initial} />);

    await user.click(screen.getByRole("button", { name: "保存" }));

    expect(
      await screen.findByText("保存されたか確認できません"),
    ).toBeInTheDocument();
    expect(screen.queryByText("保存できませんでした")).not.toBeInTheDocument();
  });

  it("W-10: after a rejection the corrected input is sent with a new key", async () => {
    const send = vi
      .fn<Send>()
      .mockImplementationOnce(
        failSend({ kind: "http", status: 422, code: "VALIDATION_FAILED" }),
      )
      .mockImplementationOnce(okSend({ name: "直した名前" }));
    const user = userEvent.setup();
    render(<RenameForm send={send} initial={initial} />);

    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(
      await screen.findByText("名前を確認してください"),
    ).toBeInTheDocument();

    await user.clear(screen.getByLabelText("名前"));
    await user.type(screen.getByLabelText("名前"), "直した名前");
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByText("保存しました")).toBeInTheDocument();

    const first = send.mock.calls[0][0];
    const second = send.mock.calls[1][0];
    expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
    expect(second.bodyJson).toBe(JSON.stringify({ name: "直した名前" }));
  });

  it("W-11: VERSION_CONFLICT shows the latest next to the input and saves with the latest ETag and a new key", async () => {
    const send = vi
      .fn<Send>()
      .mockImplementationOnce(
        failSend({ kind: "http", status: 409, code: "VERSION_CONFLICT" }),
      )
      .mockImplementationOnce(okSend({ name: "あなたの名前" }));
    const fetchLatest = vi.fn<FetchLatest>(() =>
      okAsync<ApiSuccess<TripData>, ApiFailure>({
        data: { name: "相手の名前" },
        status: 200,
        etag: '"7"',
      }),
    );
    const user = userEvent.setup();
    render(
      <RenameForm send={send} fetchLatest={fetchLatest} initial={initial} />,
    );

    const input = screen.getByLabelText("名前");
    await user.clear(input);
    await user.type(input, "あなたの名前");
    await user.click(screen.getByRole("button", { name: "保存" }));

    expect(
      await screen.findByText("相手が先に変更しました"),
    ).toBeInTheDocument();
    await waitFor(() => expect(fetchLatest).toHaveBeenCalledTimes(1));
    expect(screen.getByText("最新（あおい）")).toBeInTheDocument();
    expect(screen.getByText("相手の名前")).toBeInTheDocument();
    expect(screen.getByText("あなたの入力")).toBeInTheDocument();
    expect(screen.getByText("あなたの名前")).toBeInTheDocument();
    expect(screen.getByText("期間")).toBeInTheDocument();
    expect(screen.getByText("変更なし")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "あなたの入力で保存" }),
    );
    expect(await screen.findByText("保存しました")).toBeInTheDocument();

    const first = send.mock.calls[0][0];
    const second = send.mock.calls[1][0];
    expect(second.ifMatch).toBe('"7"');
    expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
    expect(second.bodyJson).toBe(JSON.stringify({ name: "あなたの名前" }));
  });

  it("W-12: 401 hides business data behind the C-1 screen", async () => {
    const send = vi.fn(
      failSend({ kind: "http", status: 401, code: "UNAUTHENTICATED" }),
    );
    const user = userEvent.setup();
    render(<RenameForm send={send} initial={initial} />);

    await user.click(screen.getByRole("button", { name: "保存" }));

    expect(
      await screen.findByText("もう一度ログインしてください"),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("名前")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "ログイン画面へ" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("保存されたか確認できていません"),
    ).not.toBeInTheDocument();
  });

  it("W-12: a 401 on the confirmation after an unknown result adds the unconfirmed message", async () => {
    const send = vi
      .fn<Send>()
      .mockImplementationOnce(failSend({ kind: "network" }))
      .mockImplementationOnce(
        failSend({ kind: "http", status: 401, code: "UNAUTHENTICATED" }),
      );
    const user = userEvent.setup();
    render(<RenameForm send={send} initial={initial} />);

    await user.click(screen.getByRole("button", { name: "保存" }));
    await user.click(
      await screen.findByRole("button", { name: "同じ内容で確認する" }),
    );

    expect(
      await screen.findByText("もう一度ログインしてください"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/保存されたか確認できていません/),
    ).toBeInTheDocument();
  });

  it("unknown cannot return to editing and resend with a new key", async () => {
    const send = vi
      .fn<Send>()
      .mockImplementationOnce(failSend({ kind: "network" }))
      .mockImplementationOnce(okSend({ name: "秋の京都" }));
    const user = userEvent.setup();
    render(<RenameForm send={send} initial={initial} />);

    await user.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByText("保存されたか確認できません");

    await user.click(screen.getByRole("button", { name: "編集に戻す" }));
    expect(
      screen.getByText("保存されたか確認できません"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "保存" }),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "同じ内容で確認する" }),
    );
    expect(await screen.findByText("保存しました")).toBeInTheDocument();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0].idempotencyKey).toBe(
      send.mock.calls[0][0].idempotencyKey,
    );
  });

  it("W-24: a refetch with a new value does not overwrite the input being edited", async () => {
    const send = vi.fn(pendingSend());
    const user = userEvent.setup();

    function WithRefetch() {
      const [server, setServer] = useState("元の名前");
      return (
        <>
          <RenameForm send={send} initial={{ name: server }} />
          <button type="button" onClick={() => setServer("相手の名前")}>
            refetch
          </button>
        </>
      );
    }
    render(<WithRefetch />);

    const input = screen.getByLabelText("名前");
    await user.clear(input);
    await user.type(input, "入力中の名前");
    await user.click(screen.getByRole("button", { name: "refetch" }));

    expect(input).toHaveValue("入力中の名前");
  });
});

const tripSchema = z.object({ name: z.string() });

describe("W-25: only the error code is used (no server text on screen)", () => {
  it("a 409 body with message/requestId/code shows none of their strings", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: "VERSION_CONFLICT",
            message: "サーバーの秘密の文面",
            requestId: "req-secret-1",
            retryable: false,
          }),
          { status: 409 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ name: "相手の名前" }), {
          status: 200,
          headers: { ETag: '"7"' },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const send: Send = (request) => sendMutationRequest(request, tripSchema);
    const fetchLatest: FetchLatest = () =>
      callApiWithMeta(
        httpClient<{ data: unknown; status: number; headers: Headers }>(
          "/api/trips/trip-1",
          { method: "GET" },
        ),
        tripSchema,
      );

    const user = userEvent.setup();
    const { container } = render(
      <RenameForm send={send} fetchLatest={fetchLatest} initial={initial} />,
    );

    await user.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByText("相手が先に変更しました");
    await screen.findByText("最新（あおい）");

    expect(container.textContent).not.toContain("サーバーの秘密の文面");
    expect(container.textContent).not.toContain("req-secret-1");
    expect(container.textContent).not.toContain("VERSION_CONFLICT");

    vi.unstubAllGlobals();
  });
});
