import { useCallback, useRef, useState } from "react";
import type { ResultAsync } from "neverthrow";
import type { ApiErrorCode, ApiFailure } from "./api-failure";
import type { ApiSuccess } from "./api-result";
import {
  createMutationRequest,
  type MutationDraft,
  type MutationRequest,
} from "./mutation-request";

export type SaveState<TData = unknown, TLatest = unknown> =
  | { status: "editing" }
  | { status: "saving"; request: MutationRequest }
  | { status: "succeeded"; result: ApiSuccess<TData> }
  | {
      status: "rejected";
      code: ApiErrorCode | null;
      httpStatus: number;
      request: MutationRequest;
    }
  | { status: "unknown"; request: MutationRequest }
  | {
      status: "session-expired";
      /** 結果不明のあとの確認が 401 だったとき true（最初の要求の結果が分からない）。 */
      unconfirmed: boolean;
    }
  | {
      status: "conflict";
      request: MutationRequest;
      /** 最新の取得が終わるまで null。 */
      latest: ApiSuccess<TLatest> | null;
      latestFailed: boolean;
    };

type FailureAction =
  | { status: "unknown" }
  | { status: "session-expired" }
  | { status: "conflict" }
  | { status: "rejected"; code: ApiErrorCode | null; httpStatus: number };

// network・5xx・応答の解釈の失敗は保存失敗と断定できないため unknown にする。
// 409 は VERSION_CONFLICT のときだけ conflict、ほかの code は rejected。
function classifyFailure(failure: ApiFailure): FailureAction {
  if (failure.kind !== "http") {
    return { status: "unknown" };
  }
  if (failure.status === 401) {
    return { status: "session-expired" };
  }
  if (failure.status === 409 && failure.code === "VERSION_CONFLICT") {
    return { status: "conflict" };
  }
  if (failure.status >= 400 && failure.status < 500) {
    return { status: "rejected", code: failure.code, httpStatus: failure.status };
  }
  return { status: "unknown" };
}

export type UseSaveStateOptions<TData, TLatest> = {
  send: (request: MutationRequest) => ResultAsync<ApiSuccess<TData>, ApiFailure>;
  /** conflict になったとき最新を取得する関数（最新の ETag が「あなたの入力で保存」の If-Match になる）。 */
  fetchLatest?: (() => ResultAsync<ApiSuccess<TLatest>, ApiFailure>) | null;
  onSucceeded?: ((result: ApiSuccess<TData>) => void) | null;
};

/**
 * 書き込みの保存状態。`submit` は送るたびに新しい要求（新しいキー）を作る。
 * 結果不明（network・5xx・応答の解釈失敗）は `unknown` で、その要求は
 * `confirmWithSameRequest` で同じキー・本文・If-Match のままだけ送り直せる
 * （`unknown` の間は `submit` を受け付けず、別の入力で保存し直させない）。
 * 401 は `session-expired`。`unknown` のあとの確認が 401 なら `unconfirmed: true`。
 * 409 かつ code が VERSION_CONFLICT のときだけ `conflict`。
 * `conflict` で `saveMineOverLatest` を呼ぶと、同じ本文・最新の ETag・新しいキーで送る。
 */
export function useSaveState<TData = unknown, TLatest = unknown>(
  options: UseSaveStateOptions<TData, TLatest>,
) {
  const [state, setState] = useState<SaveState<TData, TLatest>>({
    status: "editing",
  });
  const busyRef = useRef(false);
  const sendRef = useRef(options.send);
  const fetchLatestRef = useRef(options.fetchLatest ?? null);
  const onSucceededRef = useRef(options.onSucceeded ?? null);
  sendRef.current = options.send;
  fetchLatestRef.current = options.fetchLatest ?? null;
  onSucceededRef.current = options.onSucceeded ?? null;

  const run = useCallback(
    async (request: MutationRequest, afterUnknown: boolean) => {
      setState({ status: "saving", request });
      const outcome = await sendRef.current(request);
      if (outcome.isOk()) {
        setState({ status: "succeeded", result: outcome.value });
        onSucceededRef.current?.(outcome.value);
        return;
      }
      const action = classifyFailure(outcome.error);
      switch (action.status) {
        case "unknown":
          setState({ status: "unknown", request });
          return;
        case "session-expired":
          setState({ status: "session-expired", unconfirmed: afterUnknown });
          return;
        case "rejected":
          setState({
            status: "rejected",
            code: action.code,
            httpStatus: action.httpStatus,
            request,
          });
          return;
        case "conflict": {
          setState({ status: "conflict", request, latest: null, latestFailed: false });
          const fetchLatest = fetchLatestRef.current;
          if (fetchLatest === null) {
            setState((current) =>
              current.status === "conflict"
                ? { ...current, latestFailed: true }
                : current,
            );
            return;
          }
          const latest = await fetchLatest();
          latest.match(
            (value) =>
              setState((current) =>
                current.status === "conflict"
                  ? { ...current, latest: value }
                  : current,
              ),
            (failure) => {
              if (failure.kind === "http" && failure.status === 401) {
                setState({
                  status: "session-expired",
                  unconfirmed: afterUnknown,
                });
              } else {
                setState((current) =>
                  current.status === "conflict"
                    ? { ...current, latestFailed: true }
                    : current,
                );
              }
            },
          );
          return;
        }
      }
    },
    [],
  );

  const submit = useCallback(
    async (draft: MutationDraft) => {
      if (
        busyRef.current ||
        (state.status !== "editing" &&
          state.status !== "rejected" &&
          state.status !== "succeeded")
      ) {
        return;
      }
      busyRef.current = true;
      try {
        await run(createMutationRequest(draft), false);
      } finally {
        busyRef.current = false;
      }
    },
    [state.status, run],
  );

  const confirmWithSameRequest = useCallback(async () => {
    if (busyRef.current || state.status !== "unknown") {
      return;
    }
    busyRef.current = true;
    try {
      await run(state.request, true);
    } finally {
      busyRef.current = false;
    }
  }, [state, run]);

  const saveMineOverLatest = useCallback(async () => {
    if (
      busyRef.current ||
      state.status !== "conflict" ||
      state.latest === null
    ) {
      return;
    }
    const retry: MutationRequest = {
      ...state.request,
      ifMatch: state.latest.etag,
      idempotencyKey: crypto.randomUUID(),
    };
    busyRef.current = true;
    try {
      await run(retry, false);
    } finally {
      busyRef.current = false;
    }
  }, [state, run]);

  const reloadLatest = useCallback(async () => {
    if (state.status !== "conflict" || !state.latestFailed) {
      return;
    }
    const fetchLatest = fetchLatestRef.current;
    if (fetchLatest === null) {
      return;
    }
    setState({ ...state, latestFailed: false });
    const latest = await fetchLatest();
    latest.match(
      (value) =>
        setState((current) =>
          current.status === "conflict"
            ? { ...current, latest: value }
            : current,
        ),
      (failure) => {
        if (failure.kind === "http" && failure.status === 401) {
          setState({ status: "session-expired", unconfirmed: false });
        } else {
          setState((current) =>
            current.status === "conflict"
              ? { ...current, latestFailed: true }
              : current,
          );
        }
      },
    );
  }, [state]);

  const backToEditing = useCallback(() => {
    setState({ status: "editing" });
  }, []);

  return {
    state,
    submit,
    confirmWithSameRequest,
    saveMineOverLatest,
    reloadLatest,
    backToEditing,
  };
}
