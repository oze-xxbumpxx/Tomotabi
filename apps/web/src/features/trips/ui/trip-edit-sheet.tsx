"use client";

import { Check } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import type { Trip } from "@tomotabi/contracts";
import { formatTripPeriod } from "@/shared/lib/local-date";
import { Sheet } from "@/shared/ui/sheet";
import { ConflictNotice } from "@/shared/ui/state/conflict";
import { SaveUnknown } from "@/shared/ui/state/save-unknown";
import { useOnlineStatus } from "@/shared/ui/state/use-online-status";
import { StatusText } from "@/shared/ui/status-text";
import {
  firstInvalidField,
  validateTripForm,
  type TripFormErrors,
  type TripFormField,
} from "../model/trip-form";
import {
  renameTripDraft,
  sendRenameTrip,
  sendUpdateTripPeriod,
  updateTripPeriodDraft,
} from "../api/trips-api";
import {
  etagOf,
  useTripMutation,
  type TripSaveState,
} from "../model/trip-save";
import { TripFormFields } from "./trip-form-fields";

type RejectedState = Extract<TripSaveState, { status: "rejected" }>;

/** 403 / 404の拒否はC-2に切り替える対象（欄のエラーや再送は出さない）。 */
function isNotAvailableState(state: TripSaveState): state is RejectedState {
  return (
    state.status === "rejected" &&
    (state.httpStatus === 403 || state.httpStatus === 404)
  );
}

function nameError(state: RejectedState): string {
  if (state.httpStatus === 428) {
    return "画面を更新してからやり直してください";
  }
  return state.code === "VALIDATION_FAILED"
    ? "旅行名を確認してください"
    : "旅行名を保存できませんでした。もう一度お試しください。";
}

function periodError(state: RejectedState): string {
  if (state.httpStatus === 428) {
    return "画面を更新してからやり直してください";
  }
  switch (state.code) {
    case "PLAN_OUTSIDE_TRIP_PERIOD":
      return "この期間に入らない予定があります。予定の日付を先に変更してください";
    case "VALIDATION_FAILED":
      return "期間を確認してください";
    default:
      return "期間を保存できませんでした。もう一度お試しください。";
  }
}

function sessionExpiredOf(
  states: TripSaveState[],
): Extract<TripSaveState, { status: "session-expired" }> | null {
  return (
    states.find(
      (state): state is Extract<TripSaveState, { status: "session-expired" }> =>
        state.status === "session-expired",
    ) ?? null
  );
}

/**
 * 「旅行名と期間を変更」のシート（作成と同じ形。値を入れた状態で開く）。
 * 名前と期間は別のAPIなので、変わった方だけを送る。両方変わったら
 * 名前（PATCH）→ 期間（PUT）の順に送り、途中で失敗したらその時点の
 * 結果を表示する（期間が失敗しても、保存済みの名前は「保存済み」のまま）。
 */
export function TripEditSheet({
  trip,
  etag,
  onClose,
  onSaved,
  onSessionExpired,
  onNotAvailable,
}: {
  trip: Trip;
  etag: string;
  onClose: () => void;
  /** 必要な送信がすべて成功したとき。呼び出し側はシートを閉じてトーストを出す。 */
  onSaved: () => void;
  /** 401（C-1）。業務データを隠すため呼び出し側が全面を差し替える。 */
  onSessionExpired: (unconfirmed: boolean) => void;
  /** 書き込みが403 / 404で拒否（C-2）。呼び出し側が全面を差し替える。 */
  onNotAvailable: () => void;
}) {
  const online = useOnlineStatus();
  const [name, setName] = useState(trip.name);
  const [startsOn, setStartsOn] = useState(trip.startsOn);
  const [endsOn, setEndsOn] = useState(trip.endsOn);
  const [errors, setErrors] = useState<TripFormErrors>({});
  const nameRef = useRef<HTMLInputElement>(null);
  const startsOnRef = useRef<HTMLInputElement>(null);
  const endsOnRef = useRef<HTMLInputElement>(null);
  const fieldRefs = {
    name: nameRef,
    startsOn: startsOnRef,
    endsOn: endsOnRef,
  };

  // サーバーに保存済みの値。送信のたびに更新し、「変わったか」の比較基準にする。
  const savedRef = useRef({
    name: trip.name,
    startsOn: trip.startsOn,
    endsOn: trip.endsOn,
  });
  // 直近の書き込み応答が返したETag。次の送信ではpropのetagよりこちらを優先する
  //（名前の保存が成功したあとはversionが進むため）。
  const etagRef = useRef(etag);

  const periodChanged = () =>
    startsOn !== savedRef.current.startsOn || endsOn !== savedRef.current.endsOn;

  const periodDraft = (ifMatch: string | null) =>
    updateTripPeriodDraft(trip.id, { startsOn, endsOn }, ifMatch);

  const period = useTripMutation({
    tripId: trip.id,
    send: sendUpdateTripPeriod,
    onSucceeded: (result) => {
      etagRef.current = etagOf(result);
      savedRef.current = {
        ...savedRef.current,
        startsOn: result.data.startsOn,
        endsOn: result.data.endsOn,
      };
      onSaved();
    },
  });

  const rename = useTripMutation({
    tripId: trip.id,
    send: sendRenameTrip,
    onSucceeded: (result) => {
      etagRef.current = etagOf(result);
      savedRef.current = { ...savedRef.current, name: result.data.name };
      // 名前の保存が済んでから期間を送る（変わった方だけを送る順序）。
      if (periodChanged()) {
        void period.submit(periodDraft(etagOf(result)));
      } else {
        onSaved();
      }
    },
  });

  useEffect(() => {
    const expired = sessionExpiredOf([rename.state, period.state]);
    if (expired !== null) {
      onSessionExpired(expired.unconfirmed);
      return;
    }
    if (
      isNotAvailableState(rename.state) ||
      isNotAvailableState(period.state)
    ) {
      onNotAvailable();
    }
  }, [rename.state, period.state, onSessionExpired, onNotAvailable]);

  const onChange = (field: TripFormField, value: string) => {
    if (field === "name") {
      setName(value);
      rename.backToEditing();
    } else if (field === "startsOn") {
      setStartsOn(value);
      period.backToEditing();
    } else {
      setEndsOn(value);
      period.backToEditing();
    }
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  const save = () => {
    const found = validateTripForm({ name, startsOn, endsOn });
    setErrors(found);
    const first = firstInvalidField(found);
    if (first !== null) {
      fieldRefs[first].current?.focus();
      return;
    }
    if (name.trim() !== savedRef.current.name) {
      void rename.submit(
        renameTripDraft(trip.id, name.trim(), etagRef.current),
      );
      return;
    }
    if (periodChanged()) {
      void period.submit(periodDraft(etagRef.current));
      return;
    }
    // 未変更なら送らずに閉じる。
    onClose();
  };

  const unknownSave = [rename, period].find(
    (save) => save.state.status === "unknown",
  );
  const conflictSave = [rename, period].find(
    (save) => save.state.status === "conflict",
  );
  const saving =
    rename.state.status === "saving" || period.state.status === "saving";

  const displayErrors: TripFormErrors = {
    name:
      errors.name ??
      (rename.state.status === "rejected" &&
      !isNotAvailableState(rename.state)
        ? nameError(rename.state)
        : null) ??
      undefined,
    startsOn: errors.startsOn ?? undefined,
    endsOn:
      errors.endsOn ??
      (period.state.status === "rejected" &&
      !isNotAvailableState(period.state)
        ? periodError(period.state)
        : null) ??
      undefined,
  };

  // saving・結果不明のあいだは閉じない（同じ要求の確認を残すため）。
  const tryClose = () => {
    if (saving || unknownSave !== undefined) {
      return;
    }
    onClose();
  };

  const conflictRows = (latest: Trip) => [
    {
      label: "旅行名",
      mine: name,
      latest: latest.name === name.trim() ? null : latest.name,
    },
    {
      label: "期間",
      mine: formatTripPeriod(startsOn, endsOn),
      latest:
        latest.startsOn === startsOn && latest.endsOn === endsOn
          ? null
          : formatTripPeriod(latest.startsOn, latest.endsOn),
    },
  ];

  return (
    <Sheet
      title="旅行名と期間を変更"
      onClose={tryClose}
      footer={
        unknownSave !== undefined || conflictSave !== undefined ? null : (
          <>
            <button
              type="button"
              className="btn-secondary"
              onClick={tryClose}
              disabled={saving}
            >
              やめる
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={save}
              disabled={saving || !online}
            >
              {saving ? "保存中" : "保存"}
            </button>
          </>
        )
      }
    >
      {!online && (
        <StatusText>オフラインのため保存できません。</StatusText>
      )}
      {unknownSave !== undefined && (
        <SaveUnknown
          onConfirm={() => void unknownSave.confirmWithSameRequest()}
        />
      )}
      {conflictSave !== undefined &&
        (conflictSave.state.status === "conflict" &&
          (conflictSave.state.latest === null ? (
            conflictSave.state.latestFailed ? (
              <>
                <StatusText tone="error">
                  最新の内容を取得できませんでした。
                </StatusText>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => void conflictSave.reloadLatest()}
                >
                  再試行
                </button>
              </>
            ) : (
              <StatusText>読み込み中です</StatusText>
            )
          ) : (
            <ConflictNotice
              rows={conflictRows(conflictSave.state.latest.data)}
              onSaveMine={() => void conflictSave.saveMineOverLatest()}
              onUseLatest={() => {
                const latest =
                  conflictSave.state.status === "conflict"
                    ? conflictSave.state.latest
                    : null;
                if (latest !== null) {
                  setName(latest.data.name);
                  setStartsOn(latest.data.startsOn);
                  setEndsOn(latest.data.endsOn);
                  savedRef.current = {
                    name: latest.data.name,
                    startsOn: latest.data.startsOn,
                    endsOn: latest.data.endsOn,
                  };
                }
                conflictSave.backToEditing();
              }}
            />
          )))}
      {conflictSave === undefined && (
        <>
          <TripFormFields
            values={{ name, startsOn, endsOn }}
            errors={displayErrors}
            locked={saving || unknownSave !== undefined}
            fieldRefs={fieldRefs}
            onChange={onChange}
          />
          {rename.state.status === "succeeded" && (
            <p className="field-saved">
              <Check size={14} weight="bold" aria-hidden="true" />
              旅行名は保存済みです
            </p>
          )}
        </>
      )}
    </Sheet>
  );
}
