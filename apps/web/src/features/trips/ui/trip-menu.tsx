"use client";

import {
  CaretDown,
  CaretRight,
  Flag,
  FlagCheckered,
  PencilSimple,
  SignOut,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";
import type { Trip } from "@tomotabi/contracts";
import type { PendingRequestCheck } from "@/shared/browser/use-pending-request-check";
import { formatTripPeriod } from "@/shared/lib/local-date";
import { ConflictNotice } from "@/shared/ui/state/conflict";
import { SaveUnknown } from "@/shared/ui/state/save-unknown";
import { StorageUnavailable } from "@/shared/ui/state/storage-unavailable";
import { useOnlineStatus } from "@/shared/ui/state/use-online-status";
import { Sheet } from "@/shared/ui/sheet";
import { StatusText } from "@/shared/ui/status-text";
import { startTripDraft } from "../api/trips-api";
import type { TripSave } from "../model/trip-save";
import { TRIP_STATUS_LABEL, TripStatusBadge } from "./trip-status-badge";

type MenuItemProps = {
  icon: ReactNode;
  label: string;
  note?: string | null;
  disabled?: boolean;
  onClick: () => void;
};

function MenuItem({ icon, label, note, disabled, onClick }: MenuItemProps) {
  return (
    <button
      type="button"
      className="menu-item"
      onClick={onClick}
      disabled={disabled === true}
    >
      <span className="menu-item-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="menu-item-main">
        <span className="menu-item-label">{label}</span>
        {note !== null && note !== undefined && (
          <span className="menu-item-sub">{note}</span>
        )}
      </span>
      <CaretRight
        size={16}
        weight="bold"
        className="menu-item-caret"
        aria-hidden="true"
      />
    </button>
  );
}

function StartStateBlock({ start }: { start: TripSave }) {
  const state = start.state;
  switch (state.status) {
    case "saving":
      return <StatusText>開始しています</StatusText>;
    case "rejected":
      // 拒否のあとは同じETagで再送しない。閉じると最新を取り直す。
      return (
        <div className="menu-status">
          <StatusText tone="error">
            {state.httpStatus === 428
              ? "画面を更新してからやり直してください"
              : "開始できませんでした。画面を更新してやり直してください。"}
          </StatusText>
        </div>
      );
    case "unknown":
      return (
        <SaveUnknown
          onConfirm={() => void start.confirmWithSameRequest()}
        />
      );
    case "storage-unavailable":
      return <StorageUnavailable />;
    case "conflict":
      return (
        <StartConflict start={start} />
      );
    default:
      return null;
  }
}

function StartConflict({ start }: { start: TripSave }) {
  const state = start.state;
  if (state.status !== "conflict") {
    return null;
  }
  if (state.latestFailed) {
    return (
      <div className="menu-status">
        <StatusText tone="error">最新の内容を取得できませんでした。</StatusText>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => void start.reloadLatest()}
        >
          再試行
        </button>
      </div>
    );
  }
  if (state.latest === null) {
    return <StatusText>読み込み中です</StatusText>;
  }
  const latestStatus = state.latest.data.status;
  return (
    <ConflictNotice
      rows={[
        {
          label: "状態",
          mine: "旅行中",
          latest: latestStatus === "traveling" ? null : TRIP_STATUS_LABEL[latestStatus],
        },
      ]}
      onSaveMine={() => void start.saveMineOverLatest()}
      onUseLatest={() => start.backToEditing()}
    />
  );
}

/**
 * 旅行のメニュー（16）。シートの見出しは旅行名、期間と状態バッジを付ける。
 * 「旅行を開始する」の状態遷移はシートの中に出す（結果不明は同じ要求で確認）。
 * 「旅行を終了する」は確認ダイアログ（17）を呼び出し側が開く。
 * 開始の保留が残っていれば「保存されたか確認できません」と送り直しの
 * ボタンを出し、開始の項目だけは押せなくする（ほかの操作は止めない）。
 */
export function TripMenu({
  trip,
  etag,
  displayName,
  start,
  startPending,
  onEdit,
  onRequestFinish,
  onSwitch,
  onSignOut,
  signOutPending,
  signOutFailed,
  onClose,
}: {
  trip: Trip;
  etag: string;
  displayName: string | null;
  start: TripSave;
  /** 「旅行を開始する」の保留の照合結果（再読み込みつき）。 */
  startPending: { check: PendingRequestCheck; reload: () => void };
  onEdit: () => void;
  onRequestFinish: () => void;
  onSwitch: () => void;
  onSignOut: () => void;
  signOutPending: boolean;
  signOutFailed: boolean;
  onClose: () => void;
}) {
  const online = useOnlineStatus();

  const startInFlight =
    start.state.status !== "editing" && start.state.status !== "succeeded";
  const pendingFound = startPending.check.status === "found";

  return (
    <Sheet title={trip.name} onClose={onClose}>
      <div className="menu-trip-meta">
        <span className="trip-header-period tabular-nums">
          {formatTripPeriod(trip.startsOn, trip.endsOn)}
        </span>
        <TripStatusBadge status={trip.status} />
      </div>
      {/* 書き込み中・結果不明は StartStateBlock が確認を出すので、
          保留の確認は編集待ち（editing / succeeded）のあいだだけ出す。 */}
      {!startInFlight && pendingFound && (
        <SaveUnknown
          onConfirm={() => {
            if (startPending.check.status !== "found") {
              return;
            }
            void start
              .confirmRequest(startPending.check.record)
              .then(startPending.reload);
          }}
        />
      )}
      {!startInFlight && startPending.check.status === "unavailable" && (
        <StorageUnavailable />
      )}
      {startInFlight ? (
        <StartStateBlock start={start} />
      ) : (
        <div className="menu-card">
          <MenuItem
            icon={<PencilSimple size={22} />}
            label="旅行名と期間を変更"
            onClick={onEdit}
          />
          {trip.status === "planning" && (
            <MenuItem
              icon={<Flag size={22} />}
              label="旅行を開始する"
              disabled={!online || startPending.check.status !== "none"}
              onClick={() => void start.submit(startTripDraft(trip.id, etag))}
            />
          )}
          {trip.status === "traveling" && (
            <MenuItem
              icon={<FlagCheckered size={22} />}
              label="旅行を終了する"
              note="終了後も記録・編集・精算はできます"
              onClick={onRequestFinish}
            />
          )}
          <MenuItem
            icon={<CaretDown size={22} />}
            label="旅行を切り替え"
            onClick={onSwitch}
          />
          <MenuItem
            icon={<SignOut size={22} />}
            label="ログアウト"
            note={
              displayName !== null ? `${displayName} としてログイン中` : null
            }
            disabled={signOutPending}
            onClick={onSignOut}
          />
        </div>
      )}
      {signOutFailed && (
        <StatusText tone="error">
          ログアウトできませんでした。もう一度お試しください。
        </StatusText>
      )}
      {!online && (
        <StatusText>オフラインのため開始・終了の操作はできません。</StatusText>
      )}
    </Sheet>
  );
}
