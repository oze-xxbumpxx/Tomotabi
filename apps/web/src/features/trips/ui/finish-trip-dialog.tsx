"use client";

import { FlagCheckered } from "@phosphor-icons/react";
import type { Trip } from "@tomotabi/contracts";
import { Dialog } from "@/shared/ui/dialog";
import { ConflictNotice } from "@/shared/ui/state/conflict";
import { SaveUnknown } from "@/shared/ui/state/save-unknown";
import { useOnlineStatus } from "@/shared/ui/state/use-online-status";
import { StatusText } from "@/shared/ui/status-text";
import { finishTripDraft } from "../api/trips-api";
import type { TripSave } from "../model/trip-save";
import { TRIP_STATUS_LABEL } from "./trip-status-badge";

/**
 * 旅行の終了の確認（17）。終了は取り消しではないため黒のボタン。
 * 結果不明・競合・拒否はダイアログの中で状態を出し、同じ要求で確かめる。
 */
export function FinishTripDialog({
  trip,
  etag,
  finish,
  onClose,
}: {
  trip: Trip;
  etag: string;
  finish: TripSave;
  onClose: () => void;
}) {
  const online = useOnlineStatus();
  const state = finish.state;

  const submit = () => {
    void finish.submit(finishTripDraft(trip.id, etag));
  };

  return (
    <Dialog title="旅行を終了しますか？" onClose={onClose}>
      {state.status === "unknown" && (
        <SaveUnknown onConfirm={() => void finish.confirmWithSameRequest()} />
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
        state.status === "rejected") && (
        <>
          <p className="dialog-body">
            {`「${trip.name}」を終了します。未精算分があっても、終了後に精算できます。記録や編集もこれまでどおりできます。`}
          </p>
          {state.status === "rejected" && (
            <StatusText tone="error">
              {state.code === "INVALID_TRIP_TRANSITION"
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
              disabled={state.status === "saving" || !online}
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
