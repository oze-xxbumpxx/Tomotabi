"use client";

import { Prohibit } from "@phosphor-icons/react";
import { useEffect } from "react";
import type { Plan } from "@tomotabi/contracts";
import { formatLocalDate } from "@/shared/lib/local-date";
import { Dialog } from "@/shared/ui/dialog";
import { ConflictNotice } from "@/shared/ui/state/conflict";
import { SaveUnknown } from "@/shared/ui/state/save-unknown";
import { useOnlineStatus } from "@/shared/ui/state/use-online-status";
import { StatusText } from "@/shared/ui/status-text";
import { cancelPlanDraft } from "../api/plans-api";
import type { PlanSave, PlanSaveState } from "../model/plan-save";

type RejectedState = Extract<PlanSaveState, { status: "rejected" }>;

/** 403 / 404 の拒否は C-2 に切り替える対象（欄のエラーや再送は出さない）。 */
function isNotAvailableState(state: PlanSaveState): state is RejectedState {
  return (
    state.status === "rejected" &&
    (state.httpStatus === 403 || state.httpStatus === 404)
  );
}

/**
 * 取りやめの確認（17 の形、決定ボタンは危険色）。
 * 名前と日付を見せ、記録が残ることを伝える。結果不明・競合・拒否は
 * ダイアログの中で状態を出し、同じ要求で確かめる。
 */
export function CancelPlanDialog({
  plan,
  etag,
  cancel,
  onClose,
  onSessionExpired,
  onNotAvailable,
}: {
  plan: Plan;
  etag: string;
  cancel: PlanSave;
  onClose: () => void;
  onSessionExpired: (unconfirmed: boolean) => void;
  /** 書き込みが 403 / 404 で拒否（C-2）。呼び出し側が全面を差し替える。 */
  onNotAvailable: (target: "trip" | "item") => void;
}) {
  const online = useOnlineStatus();
  const state = cancel.state;

  // C-1 / C-2 は呼び出し側の全面表示に切り替える。
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
    void cancel.submit(cancelPlanDraft(plan.tripId, plan.id, etag));
  };

  const tryClose = () => {
    if (state.status === "saving" || state.status === "unknown") {
      return;
    }
    onClose();
  };

  return (
    <Dialog title="予定を取りやめにしますか？" onClose={tryClose}>
      {state.status === "unknown" && (
        <SaveUnknown onConfirm={() => void cancel.confirmWithSameRequest()} />
      )}
      {state.status === "conflict" &&
        (state.latest === null ? (
          state.latestFailed ? (
            <>
              <StatusText tone="error">
                最新の内容を取得できませんでした。
              </StatusText>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => void cancel.reloadLatest()}
              >
                再試行
              </button>
            </>
          ) : (
            <StatusText>読み込み中です</StatusText>
          )
        ) : (
          <ConflictNotice
            rows={[
              {
                label: "状態",
                mine: "取りやめ",
                latest:
                  state.latest.data.cancelledAt === null
                    ? "予定あり"
                    : null,
              },
            ]}
            onSaveMine={() => void cancel.saveMineOverLatest()}
            onUseLatest={() => {
              cancel.backToEditing();
              onClose();
            }}
          />
        ))}
      {(state.status === "editing" ||
        state.status === "saving" ||
        state.status === "rejected") && (
        <>
          <p className="dialog-body">
            {`「${plan.name}」（${formatLocalDate(plan.date)}）を取りやめにします。達成・予約・支払いの記録は残ります。`}
          </p>
          {state.status === "rejected" && (
            <StatusText tone="error">
              {state.httpStatus === 428
                ? "画面を更新してからやり直してください"
                : state.code === "PLAN_CANCELLED"
                  ? "予定の状態が変わっています。閉じて開き直してください。"
                  : "取りやめにできませんでした。もう一度お試しください。"}
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
              // 拒否のあとに同じ古い ETag で再送するボタンは出さない。
              // 閉じて開き直すと最新の ETag で送れる。
              disabled={
                state.status === "saving" ||
                !online ||
                state.status === "rejected"
              }
            >
              <Prohibit size={16} weight="bold" aria-hidden="true" />
              {state.status === "saving" ? "保存中" : "取りやめにする"}
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
}
