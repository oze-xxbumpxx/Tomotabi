import { useCallback, useRef, useState } from "react";
import type { ResultAsync } from "neverthrow";
import type { ApiErrorCode, ApiFailure } from "./api-failure";
import type { ApiSuccess } from "./api-result";
import {
  deletePendingRequest,
  pendingRequestToMutation,
  savePendingRequest,
  toPendingRequestRecord,
  type PendingRequestRecord,
} from "@/shared/browser/pending-requests";
import type { PendingRequestCheck } from "@/shared/browser/use-pending-request-check";
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
      /** 送る前の保存（IndexedDB）が失敗し、まだ何も送っていない状態。 */
      status: "storage-unavailable";
    }
  | {
      status: "session-expired";
      /** 結果不明のあとの確認が401だったときtrue（最初の要求の結果が分からない）。 */
      unconfirmed: boolean;
    }
  | {
      status: "conflict";
      request: MutationRequest;
      /** 最新の取得が終わるまでnull。 */
      latest: ApiSuccess<TLatest> | null;
      latestFailed: boolean;
    };

type FailureAction =
  | { status: "unknown" }
  | { status: "session-expired" }
  | { status: "conflict" }
  | { status: "rejected"; code: ApiErrorCode | null; httpStatus: number };

// network・5xx・応答の解釈の失敗は保存失敗と断定できないためunknownにする。
// 409はVERSION_CONFLICTのときだけconflict、ほかのcodeはrejected。
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
  /** conflictになったとき最新を取得する関数（最新のETagが「あなたの入力で保存」のIf-Matchになる）。 */
  fetchLatest?: (() => ResultAsync<ApiSuccess<TLatest>, ApiFailure>) | null;
  onSucceeded?: ((result: ApiSuccess<TData>) => void) | null;
  /**
   * 結果不明の要求をIndexedDBに残す操作の指定（ADR-0006）。
   * 指定した操作だけ有効になり、送る前に保存し、保存に失敗したら
   * `storage-unavailable`で止めて送らない。成功・確定した拒否で消し、
   * 結果不明・認証期限切れでは残す。未指定の操作の振る舞いは変わらない。
   * `check`に`usePendingRequestCheck`の結果を渡すと、保留がある・
   * まだ確認中・確認できないあいだは`submit`（新しいキーでの保存）を
   * 受け付けない（同じ要求の再送で二重に作られないようにする）。
   */
  pendingRequest?: {
    userId: string;
    tripId: string;
    check?: PendingRequestCheck;
  } | null;
};

/**
 * 書き込みの保存状態。`submit`は送るたびに新しい要求（新しいキー）を作る。
 * 結果不明（network・5xx・応答の解釈失敗）は`unknown`で、その要求は
 * `confirmWithSameRequest`で同じキー・本文・If-Matchのままだけ送り直せる
 * （`unknown`の間は`submit`を受け付けず、別の入力で保存し直させない）。
 * 401は`session-expired`。`unknown`のあとの確認が401なら`unconfirmed: true`。
 * 409かつcodeがVERSION_CONFLICTのときだけ`conflict`。
 * `conflict`で`saveMineOverLatest`を呼ぶと、同じ本文・最新のETag・新しいキーで送る。
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
  const pendingRequestRef = useRef(options.pendingRequest ?? null);
  sendRef.current = options.send;
  fetchLatestRef.current = options.fetchLatest ?? null;
  onSucceededRef.current = options.onSucceeded ?? null;
  pendingRequestRef.current = options.pendingRequest ?? null;

  const run = useCallback(
    async (request: MutationRequest, afterUnknown: boolean) => {
      const pendingLink = pendingRequestRef.current;
      if (pendingLink !== null) {
        try {
          await savePendingRequest(
            toPendingRequestRecord({
              userId: pendingLink.userId,
              tripId: pendingLink.tripId,
              request,
            }),
          );
        } catch {
          // 端末の保存に失敗したら送らない（黙ってメモリだけに切り替えない）。
          setState({ status: "storage-unavailable" });
          return;
        }
      }
      setState({ status: "saving", request });
      const outcome = await sendRef.current(request);
      // 確定した結果（成功・拒否・競合）が返ったら保留を消す。
      // unknown・session-expiredは送れたか分からないので残す。
      const clearPending = async (): Promise<void> => {
        if (pendingLink === null) {
          return;
        }
        try {
          await deletePendingRequest(request.idempotencyKey);
        } catch {
          // 消せなくても再読み込み後の確認が受領で同じ結果を返すため続ける。
        }
      };
      if (outcome.isOk()) {
        await clearPending();
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
          await clearPending();
          setState({
            status: "rejected",
            code: action.code,
            httpStatus: action.httpStatus,
            request,
          });
          return;
        case "conflict": {
          await clearPending();
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
      const check = pendingRequestRef.current?.check;
      if (
        busyRef.current ||
        (state.status !== "editing" &&
          state.status !== "rejected" &&
          state.status !== "succeeded" &&
          state.status !== "storage-unavailable") ||
        // 未確定の保留が残っている（または残っているか未確認・確認できない）あいだは
        // 新しいキーで保存しない（同じ要求の再送で二重に作られないようにする）。
        (check !== undefined && check.status !== "none")
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

  /**
   * 再読み込み後にIndexedDBから復帰した保留を、本人の操作で同じまま送り直す。
   * `usePendingRequestCheck`で見つけたrecordをそのまま渡す（自動では呼ばない）。
   * 形・経路が確かめられないもの、今の利用者・旅行と合わないものは送らずに消す。
   */
  const confirmRequest = useCallback(
    async (record: PendingRequestRecord) => {
      if (busyRef.current) {
        return;
      }
      busyRef.current = true;
      try {
        const pendingLink = pendingRequestRef.current;
        const request = pendingRequestToMutation(record);
        if (pendingLink === null || request === null) {
          try {
            await deletePendingRequest(record.id);
          } catch {
            // 消せなくても送らないことは変わらない。
          }
          setState({ status: "storage-unavailable" });
          return;
        }
        if (
          record.userId !== pendingLink.userId ||
          record.tripId !== pendingLink.tripId
        ) {
          try {
            await deletePendingRequest(record.id);
          } catch {
            // 消せなくても送らないことは変わらない。
          }
          return;
        }
        await run(request, true);
      } finally {
        busyRef.current = false;
      }
    },
    [run],
  );

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
    // unknown（送信結果が分からない）・saving・session-expiredからは戻せない。
    // unknownで許すのはconfirmWithSameRequestによる同じ要求の確認だけで、
    // editingに戻して別のキーで送り直させない（元の保存が成功していれば二重になる）。
    setState((current) =>
      current.status === "unknown" ||
      current.status === "saving" ||
      current.status === "session-expired"
        ? current
        : { status: "editing" },
    );
  }, []);

  return {
    state,
    submit,
    confirmWithSameRequest,
    confirmRequest,
    saveMineOverLatest,
    reloadLatest,
    backToEditing,
  };
}
