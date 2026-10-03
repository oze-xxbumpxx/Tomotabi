"use client";

import { Check } from "@phosphor-icons/react";
import { useEffect } from "react";
import type {
  Participant,
  Preview,
} from "../api/settlement-api";
import { Dialog } from "@/shared/ui/dialog";
import { SaveUnknown } from "@/shared/ui/state/save-unknown";
import { StorageUnavailable } from "@/shared/ui/state/storage-unavailable";
import { useOnlineStatus } from "@/shared/ui/state/use-online-status";
import { StatusText } from "@/shared/ui/status-text";
import { formatYen } from "@/shared/lib/yen";
import { completeSettlementDraft } from "../api/settlement-api";
import {
  completionKindOf,
  transferDirectionOf,
} from "../model/breakdown";
import type { SettlementSave } from "../model/settlement-save";

/**
 * 記録の前の確認のダイアログ（v3の14d。0円でも同じ形）。
 * 「このアプリは送金を行いません」を伝える。結果不明・送れない・
 * 拒否はダイアログの中で状態を出し、同じ要求だけで確かめる。
 * 拒否（409など）は確定した拒否なので同じ内容の再送は出さず、
 * 閉じて確認を取り直す動線にする。
 */
export function CompleteSettlementDialog({
  tripId,
  preview,
  participants,
  complete,
  onClose,
  onSessionExpired,
}: {
  tripId: string;
  preview: Preview;
  participants: Participant[];
  complete: SettlementSave;
  onClose: () => void;
  onSessionExpired: (unconfirmed: boolean) => void;
}) {
  const online = useOnlineStatus();
  const state = complete.state;
  const direction = transferDirectionOf(preview.transfer, participants);
  const requiresTransfer = direction !== null;

  // C-1（ログイン切れ）は呼び出し側の全面表示に切り替える。
  useEffect(() => {
    if (state.status === "session-expired") {
      onSessionExpired(state.unconfirmed);
    }
  }, [state, onSessionExpired]);

  const submit = () => {
    void complete.submit(
      completeSettlementDraft(
        tripId,
        preview.id,
        completionKindOf(preview.transfer),
      ),
    );
  };

  const tryClose = () => {
    if (state.status === "saving" || state.status === "unknown") {
      return;
    }
    onClose();
  };

  const title = requiresTransfer
    ? "受け渡し完了を記録しますか？"
    : "精算を記録しますか？";
  const body =
    requiresTransfer && direction !== null
      ? `${direction.fromName} から ${direction.toName} へ ${formatYen(direction.amount)}を受け渡したことを記録します。このアプリは送金を行いません。`
      : "対象の支払いを、受け渡し不要として精算したことを記録します。このアプリは送金を行いません。";

  return (
    <Dialog title={title} onClose={tryClose}>
      {state.status === "unknown" && (
        <SaveUnknown
          onConfirm={() => void complete.confirmWithSameRequest()}
        />
      )}
      {state.status === "storage-unavailable" && <StorageUnavailable />}
      {(state.status === "editing" ||
        state.status === "saving" ||
        state.status === "rejected") && (
        <>
          <p className="dialog-body">{body}</p>
          {state.status === "rejected" && (
            <StatusText tone="error">
              記録できませんでした。確認の対象が変わっている可能性があります。閉じて最新の状態を確かめてください。
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
              className="btn-ink"
              onClick={submit}
              // 確定した拒否のあとに同じ内容で送り直すボタンは出さない。
              disabled={
                state.status === "saving" ||
                !online ||
                state.status === "rejected"
              }
            >
              <Check size={16} weight="bold" aria-hidden="true" />
              {state.status === "saving" ? "記録中" : "記録する"}
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
}
