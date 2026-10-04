"use client";

import { FlagCheckered } from "@phosphor-icons/react";
import type { Trip } from "@tomotabi/contracts";
import type { PendingRequestCheck } from "@/shared/browser/use-pending-request-check";
import { Dialog } from "@/shared/ui/dialog";
import { ConflictNotice } from "@/shared/ui/state/conflict";
import { SaveUnknown } from "@/shared/ui/state/save-unknown";
import { StorageUnavailable } from "@/shared/ui/state/storage-unavailable";
import { useOnlineStatus } from "@/shared/ui/state/use-online-status";
import { StatusText } from "@/shared/ui/status-text";
import { finishTripDraft } from "../api/trips-api";
import type { TripSave } from "../model/trip-save";
import { TRIP_STATUS_LABEL } from "./trip-status-badge";

/**
 * 旅行の終了の確認（17）。終了は取り消しではないため黒のボタン。
 * 結果不明・競合・拒否はダイアログの中で状態を出し、同じ要求で確かめる。
 * 終了の保留が残っていれば、新しい送信の代わりに「保存されたか確認できません」
 * と送り直しのボタンを出す（F-71・E-11）。
 */
export function FinishTripDialog({
  trip,
  etag,
  finish,
  finishPending,
  onClose,
}: {
  trip: Trip;
  etag: string;
  finish: TripSave;
  /** 「旅行を終了する」の保留の照合結果（再読み込みつき）。 */
  finishPending: { check: PendingRequestCheck; reload: () => void };
  onClose: () => void;
}) {
  const online = useOnlineStatus();
  const state = finish.state;
  const pendingFound =
    state.status === "editing" && finishPending.check.status === "found";
  const pendingUnavailable =
    state.status === "editing" && finishPending.check.status === "unavailable";

  const submit = () => {
    void finish.submit(finishTripDraft(trip.id, etag));
  };

  return (
    <Dialog title="旅行を終了しますか？" onClose={onClose}>
      {state.status === "unknown" && (
        <SaveUnknown onConfirm={() => void finish.confirmWithSameRequest()} />
      )}
      {pendingFound && (
        <SaveUnknown
          onConfirm={() => {
            if (finishPending.check.status !== "found") {
              return;
            }
            void finish
              .confirmRequest(finishPending.check.record)
              .then(finishPending.reload);
          }}
        />
      )}
      {pendingUnavailable && <StorageUnavailable />}
      {state.status === "storage-unavailable" && <StorageUnavailable />}
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
                onClick={() => void finish.reloadLatest()}
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
                mine: "終了",
                latest:
                  state.latest.data.status === "finished"
                    ? null
                    : TRIP_STATUS_LABEL[state.latest.data.status],
              },
            ]}
            onSaveMine={() => void finish.saveMineOverLatest()}
            onUseLatest={() => {
              finish.backToEditing();
              onClose();
            }}
          />
        ))}
      {(state.status === "editing" ||
        state.status === "saving" ||
        state.status === "rejected" ||
        state.status === "storage-unavailable") &&
        !pendingFound &&
        !pendingUnavailable && (
          <>
            <p className="dialog-body">
              {`「${trip.name}」を終了します。未精算分があっても、終了後に精算できます。記録や編集もこれまでどおりできます。`}
            </p>
            {state.status === "rejected" && (
              <StatusText tone="error">
                {state.httpStatus === 428
                  ? "画面を更新してからやり直してください"
                  : state.code === "INVALID_TRIP_TRANSITION"
                    ? "旅行の状態が変わっています。閉じて開き直してください。"
                    : "終了できませんでした。もう一度お試しください。"}
              </StatusText>
            )}
            <div className="dialog-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={onClose}
                disabled={state.status === "saving"}
              >
                やめる
              </button>
              <button
                type="button"
                className="btn-ink"
                onClick={submit}
                disabled={
                  state.status === "saving" ||
                  !online ||
                  finishPending.check.status !== "none"
                }
              >
                <FlagCheckered size={16} weight="bold" aria-hidden="true" />
                {state.status === "saving" ? "保存中" : "終了する"}
              </button>
            </div>
          </>
        )}
    </Dialog>
  );
}
