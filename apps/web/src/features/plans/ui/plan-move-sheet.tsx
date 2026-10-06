"use client";

import { useEffect, useState } from "react";
import type { Plan, Trip } from "@tomotabi/contracts";
import type { PendingRequestCheck } from "@/shared/browser/use-pending-request-check";
import { formatLocalDate } from "@/shared/lib/local-date";
import { Sheet } from "@/shared/ui/sheet";
import { ConflictNotice } from "@/shared/ui/state/conflict";
import { SaveUnknown } from "@/shared/ui/state/save-unknown";
import { StorageUnavailable } from "@/shared/ui/state/storage-unavailable";
import { useOnlineStatus } from "@/shared/ui/state/use-online-status";
import { StatusText } from "@/shared/ui/status-text";
import { movePlanDraft } from "../api/plans-api";
import type { PlanSave, PlanSaveState } from "../model/plan-save";
import { DatePickerGrid } from "./date-picker-grid";

type RejectedState = Extract<PlanSaveState, { status: "rejected" }>;

/** 403 / 404の拒否はC-2に切り替える対象（欄のエラーや再送は出さない）。 */
function isNotAvailableState(state: PlanSaveState): state is RejectedState {
  return (
    state.status === "rejected" &&
    (state.httpStatus === 403 || state.httpStatus === 404)
  );
}

function rejectedMessage(state: RejectedState): string {
  if (state.httpStatus === 428) {
    return "画面を更新してからやり直してください";
  }
  switch (state.code) {
    case "PLAN_OUTSIDE_TRIP_PERIOD":
      return "その日付は旅行期間の外です。旅行の期間が変わっていないか確認してください";
    case "PLAN_CANCELLED":
      return "予定の状態が変わっています。閉じて開き直してください。";
    default:
      return "移動できませんでした。もう一度お試しください。";
  }
}

/**
 * 日の移動の小さなシート（11cの日付選択だけ）。
 * 同じ日なら保存ボタンを押せない（W-20）。結果不明・競合・拒否は
 * シートの中で状態を出し、同じ要求で確かめる。
 * 移動の保留が残っていれば「保存されたか確認できません」と送り直しの
 * ボタンを出す（F-71・E-11）。
 */
export function PlanMoveSheet({
  trip,
  plan,
  etag,
  move,
  movePending,
  onClose,
  onSessionExpired,
  onNotAvailable,
}: {
  trip: Trip;
  plan: Plan;
  etag: string;
  move: PlanSave;
  /** 「日の移動」の保留の照合結果（再読み込みつき）。 */
  movePending: { check: PendingRequestCheck; reload: () => void };
  onClose: () => void;
  onSessionExpired: (unconfirmed: boolean) => void;
  /** 書き込みが403 / 404で拒否（C-2）。呼び出し側が全面を差し替える。 */
  onNotAvailable: (target: "trip" | "item") => void;
}) {
  const online = useOnlineStatus();
  const [selected, setSelected] = useState(plan.date);
  const state = move.state;
  const pendingFound = movePending.check.status === "found";
  const pendingUnavailable = movePending.check.status === "unavailable";

  const etagNow =
    state.status === "conflict" && state.latest !== null
      ? state.latest.etag
      : etag;

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

  const saving = state.status === "saving";
  const sameDay = selected === plan.date;

  const submit = () => {
    if (sameDay) {
      return;
    }
    void move.submit(movePlanDraft(trip.id, plan.id, selected, etagNow));
  };

  const tryClose = () => {
    // saving・結果不明のあいだは閉じない（同じ要求の確認を残すため）。
    if (saving || state.status === "unknown") {
      return;
    }
    onClose();
  };

  return (
    <Sheet
      title="日の移動"
      onClose={tryClose}
      footer={
        state.status === "unknown" ||
        state.status === "conflict" ||
        pendingFound ? null : (
          // 閉じるのは右上の×だけ（v3のシートの形。下は決める操作1つ）
          <>
            <button
              type="button"
              className="btn-ink"
              onClick={submit}
              // 止めるのは428（ETagが古い）のときだけ。ほかの拒否は
              // 別の日を選び直せば編集に戻り、新しいキーで送り直せる。
              disabled={
                sameDay ||
                saving ||
                !online ||
                movePending.check.status !== "none" ||
                (state.status === "rejected" && state.httpStatus === 428)
              }
            >
              {saving ? "保存中" : "この日に移動する"}
            </button>
          </>
        )
      }
    >
      {!online && (
        <StatusText>オフラインのため保存できません。</StatusText>
      )}
      {state.status === "unknown" && (
        <SaveUnknown onConfirm={() => void move.confirmWithSameRequest()} />
      )}
      {pendingFound && movePending.check.status === "found" && (
        <SaveUnknown
          onConfirm={() => {
            if (movePending.check.status !== "found") {
              return;
            }
            void move
              .confirmRequest(movePending.check.record)
              .then(movePending.reload);
          }}
          confirming={saving}
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
                onClick={() => void move.reloadLatest()}
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
                label: "日付",
                mine: formatLocalDate(selected),
                latest:
                  state.latest.data.date === selected
                    ? null
                    : formatLocalDate(state.latest.data.date),
              },
            ]}
            onSaveMine={() => void move.saveMineOverLatest()}
            onUseLatest={() => {
              move.backToEditing();
              onClose();
            }}
          />
        ))}
      {state.status !== "conflict" && (
        <>
          {state.status === "rejected" &&
            state.code !== "PLAN_OUTSIDE_TRIP_PERIOD" && (
              <StatusText tone="error">{rejectedMessage(state)}</StatusText>
            )}
          {state.status === "rejected" && state.httpStatus === 428 && (
            <button
              type="button"
              className="btn-secondary"
              onClick={onClose}
            >
              閉じて最新を取り直す
            </button>
          )}
          <DatePickerGrid
            startsOn={trip.startsOn}
            endsOn={trip.endsOn}
            value={selected}
            disabled={
              saving || state.status === "unknown" || pendingFound
            }
            onSelect={(date) => {
              setSelected(date);
              // 拒否（期間外など）のあと別の日を選び直したら編集に戻す。
              // 拒否した要求でサーバーは予定を変えないのでETagは
              // そのまま使え、送り直しは新しいキーになる。428だけは
              // 取り直すまで送らせない。
              if (
                state.status === "rejected" &&
                state.httpStatus !== 428
              ) {
                move.backToEditing();
              }
            }}
          />
          {state.status === "rejected" &&
            state.code === "PLAN_OUTSIDE_TRIP_PERIOD" && (
              <p className="field-error" role="alert">
                {rejectedMessage(state)}
              </p>
            )}
          {sameDay && (
            <p className="plan-field-note">今の日付と同じ日は選べません</p>
          )}
        </>
      )}
    </Sheet>
  );
}
