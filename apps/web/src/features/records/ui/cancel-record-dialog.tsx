import { ArrowUUpLeft } from "@phosphor-icons/react";
import { useEffect } from "react";
import type { ReactNode } from "react";
import type { ApiErrorCode } from "@/shared/api/api-failure";
import type { MutationDraft } from "@/shared/api/mutation-request";
import type { SaveState } from "@/shared/api/save-state";
import type { useSaveState } from "@/shared/api/save-state";
import type { PendingRequestCheck } from "@/shared/browser/use-pending-request-check";
import { Dialog } from "@/shared/ui/dialog";
import { SaveUnknown } from "@/shared/ui/state/save-unknown";
import { StorageUnavailable } from "@/shared/ui/state/storage-unavailable";
import { useOnlineStatus } from "@/shared/ui/state/use-online-status";
import { StatusText } from "@/shared/ui/status-text";
import type { Cancellation } from "../api/records-api";

/**
 * 記録の取り消しの確認（v3の12の形、決定ボタンは危険色）。
 * 何を取り消すか（名前・金額・時刻）を見せ、記録は消えずに履歴に
 * 残ることを伝える。支払いは、精算額が変わりうること・精算済みの分は
 * 次回の調整になることも出す。結果不明・保留・拒否はダイアログの
 * 中で状態を出し、同じ要求で確かめる。
 */

/** 支払い・達成・予約のどの取り消しでも同じ形の保存状態（Cancellationを返す）。 */
export type RecordCancelHandle = ReturnType<
  typeof useSaveState<Cancellation, Cancellation>
>;

type RejectedState = Extract<
  SaveState<Cancellation, Cancellation>,
  { status: "rejected" }
>;

/** 403 / 404の拒否はC-2に切り替える対象。 */
function isNotAvailableState(state: SaveState): state is RejectedState {
  return (
    state.status === "rejected" &&
    (state.httpStatus === 403 || state.httpStatus === 404)
  );
}

function rejectedText(code: ApiErrorCode | null): string {
  switch (code) {
    case "RECORD_ALREADY_ACTIVE":
      return "すでに記録があります。最新の状態を表示しています";
    case "PLAN_CANCELLED":
      return "取りやめた予定には記録できません";
    case "PLAN_KIND_NOT_SUPPORTED":
      return "この種類の予定には記録できません";
    default:
      return "取り消せませんでした。もう一度お試しください。";
  }
}

export function CancelRecordDialog({
  subject,
  payment,
  draft,
  save,
  pending,
  onClose,
  onSessionExpired,
  onNotAvailable,
}: {
  /** 何を取り消すか（「錦市場で昼食」の達成 / 支払い「参道で朝ごはん 2,400 円」）。 */
  subject: ReactNode;
  /** 支払いの取り消しならtrue（精算の文を添える）。 */
  payment: boolean;
  draft: MutationDraft;
  save: RecordCancelHandle;
  /** この取り消し操作の保留の照合結果（再読み込みつき）。 */
  pending: { check: PendingRequestCheck; reload: () => void };
  onClose: () => void;
  onSessionExpired: (unconfirmed: boolean) => void;
  /** 書き込みが403 / 404で拒否（C-2）。呼び出し側が全面を差し替える。 */
  onNotAvailable: (target: "trip" | "item") => void;
}) {
  const online = useOnlineStatus();
  const state = save.state;
  const pendingFound = pending.check.status === "found";
  const pendingUnavailable = pending.check.status === "unavailable";

  // C-1 / C-2は呼び出し側の全面表示に切り替える。
  useEffect(() => {
    if (state.status === "session-expired") {
      onSessionExpired(state.unconfirmed);
      return;
    }
    if (isNotAvailableState(state)) {
      onNotAvailable(state.httpStatus === 404 ? "item" : "trip");
    }
  }, [state, onSessionExpired, onNotAvailable]);

  const submit = () => {
    void save.submit(draft);
  };

  const tryClose = () => {
    if (state.status === "saving" || state.status === "unknown") {
      return;
    }
    onClose();
  };

  return (
    <Dialog title="この記録を取り消しますか？" onClose={tryClose}>
      {state.status === "unknown" && (
        <SaveUnknown
          onConfirm={() => void save.confirmWithSameRequest()}
        />
      )}
      {pendingFound && pending.check.status === "found" && (
        <SaveUnknown
          onConfirm={() => {
            if (pending.check.status !== "found") {
              return;
            }
            void save
              .confirmRequest(pending.check.record)
              .then(pending.reload);
          }}
          confirming={state.status === "saving"}
        />
      )}
      {pendingUnavailable && <StorageUnavailable />}
      {state.status === "storage-unavailable" && <StorageUnavailable />}
      {(state.status === "editing" ||
        state.status === "saving" ||
        state.status === "rejected" ||
        state.status === "storage-unavailable") &&
        !pendingFound &&
        !pendingUnavailable && (
          <>
            <p className="dialog-body">
              {subject}
              を取り消します。記録は消えず、「取り消し済み」として履歴に残ります。
              {payment &&
                "精算額が変わる場合があり、精算済みの分は次回の調整になります。"}
            </p>
            {state.status === "rejected" && (
              <StatusText tone="error">
                {rejectedText(state.code)}
              </StatusText>
            )}
            <div className="dialog-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={tryClose}
                disabled={state.status === "saving"}
              >
                やめる
              </button>
              <button
                type="button"
                className="btn-danger"
                onClick={submit}
                // 拒否のあとに同じ要求を再送するボタンは出さない。
                disabled={
                  state.status === "saving" ||
                  !online ||
                  state.status === "rejected" ||
                  pending.check.status !== "none"
                }
              >
                <ArrowUUpLeft size={16} weight="bold" aria-hidden="true" />
                {state.status === "saving" ? "取り消し中" : "取り消す"}
              </button>
            </div>
          </>
        )}
    </Dialog>
  );
}
