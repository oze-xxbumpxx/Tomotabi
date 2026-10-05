"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useMe } from "@/features/auth";
import {
  CREATE_TRIP_OPERATION,
  createTripDraft,
  firstInvalidField,
  TripFormFields,
  tripFormValuesFromJson,
  useCreateTrip,
  validateTripForm,
  type TripFormErrors,
  type TripFormField,
  type TripFormValues,
} from "@/features/trips";
import { TripsScreen } from "@/screens/trips/trips-screen";
import { NEW_TRIP_ID } from "@/shared/browser/pending-requests";
import { usePendingRequestCheck } from "@/shared/browser/use-pending-request-check";
import { Sheet } from "@/shared/ui/sheet";
import { FetchFailed } from "@/shared/ui/state/fetch-failed";
import { Loading } from "@/shared/ui/state/loading";
import { OfflineBanner } from "@/shared/ui/state/offline-banner";
import { SaveUnknown } from "@/shared/ui/state/save-unknown";
import { SessionExpired } from "@/shared/ui/state/session-expired";
import { StorageUnavailable } from "@/shared/ui/state/storage-unavailable";
import { useOnlineStatus } from "@/shared/ui/state/use-online-status";
import { StatusText } from "@/shared/ui/status-text";

/**
 * `/trips/new`の旅行の作成。v3に無い画面のため、11「支払いを記録」と
 * 同じシートの形（上端の角丸xl・見出し・閉じる）で組む。元の画面
 * （旅行一覧）をシートの後ろに敷き、透けて見えるようにする。
 * 成功したら作った旅行のしおりへ移る（選択値の保存はしおり側で行う）。
 * 作成は送る直前に端末に残し（旅行のIDの代わりに決まった値`new-trip`を
 * 入れる。ADR-0006・設計書「端末に残す仕組みの広げ方」）、同じ利用者の
 * `new-trip`の要求が残っていれば入力を固定して送り直しの確認を出す
 * （F-70〜F-73・RW-04）。
 */
export function TripNewScreen() {
  const router = useRouter();
  const { state: meState, reload: reloadMe } = useMe();
  const online = useOnlineStatus();
  const userId = meState.status === "ready" ? meState.me.user.id : null;
  const [values, setValues] = useState<TripFormValues>({
    name: "",
    startsOn: "",
    endsOn: "",
  });
  const [errors, setErrors] = useState<TripFormErrors>({});
  const nameRef = useRef<HTMLInputElement>(null);
  const startsOnRef = useRef<HTMLInputElement>(null);
  const endsOnRef = useRef<HTMLInputElement>(null);
  const fieldRefs = {
    name: nameRef,
    startsOn: startsOnRef,
    endsOn: endsOnRef,
  };

  const createCheck = usePendingRequestCheck({
    userId,
    tripId: NEW_TRIP_ID,
    operation: CREATE_TRIP_OPERATION,
  });

  const create = useCreateTrip({
    userId,
    check: createCheck.check,
    onSucceeded: (result) => {
      router.replace(`/trips/${result.data.id}/itinerary`);
    },
  });

  useEffect(() => {
    if (meState.status === "unauthenticated") {
      router.replace("/sign-in");
    }
  }, [meState.status, router]);

  const pendingRecord =
    createCheck.check.status === "found" ? createCheck.check.record : null;
  const locked = pendingRecord !== null;
  // 固定表示用の値（保留の本文から復元）。形が確かめられないものは
  // 欄を出さず、確認の操作だけを出す。
  const lockedValues =
    pendingRecord !== null && pendingRecord.bodyJson !== null
      ? tripFormValuesFromJson(pendingRecord.bodyJson)
      : null;

  const onChange = (field: TripFormField, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    create.backToEditing();
  };

  const submit = () => {
    const state = create.state;
    if (
      state.status === "saving" ||
      state.status === "unknown" ||
      locked
    ) {
      return;
    }
    const found = validateTripForm(values);
    setErrors(found);
    const first = firstInvalidField(found);
    if (first !== null) {
      fieldRefs[first].current?.focus();
      return;
    }
    void create.submit(
      createTripDraft({
        name: values.name.trim(),
        startsOn: values.startsOn,
        endsOn: values.endsOn,
      }),
    );
  };

  const state = create.state;
  const saving = state.status === "saving";
  const unknown = state.status === "unknown";

  // 送信中・結果不明のあいだは閉じない（同じ要求の確認を残すため）。
  const tryClose = () => {
    if (saving || unknown) {
      return;
    }
    router.push("/trips");
  };

  if (state.status === "session-expired") {
    return (
      <main>
        <SessionExpired
          unconfirmedTarget={state.unconfirmed ? "旅行" : null}
          onGoToSignIn={() => router.push("/sign-in")}
        />
      </main>
    );
  }

  // 利用者の情報が取れないと保留の照合が作れない。
  if (meState.status === "error" || meState.status === "unavailable") {
    return (
      <main>
        <FetchFailed
          message="利用者の情報を取得できませんでした"
          onRetry={() => void reloadMe()}
        />
      </main>
    );
  }

  if (userId === null || createCheck.check.status === "checking") {
    return (
      <>
        <TripsScreen />
        {/* key でフォーム用のシートと入れ替え、開き直して初期フォーカスを当て直す */}
        <Sheet key="loading" title="新しい旅行" onClose={tryClose}>
          <Loading />
        </Sheet>
      </>
    );
  }

  const storageUnavailable =
    state.status === "storage-unavailable" ||
    (createCheck.check.status === "unavailable" && !locked);
  const fieldsLocked = locked || saving || unknown;

  return (
    <>
      <TripsScreen />
      <Sheet
        key="form"
        title="新しい旅行"
        onClose={tryClose}
        initialFocus={locked ? undefined : nameRef}
        footer={
          unknown ? null : locked ? (
            <button
              type="button"
              className="btn-secondary"
              onClick={tryClose}
            >
              やめる
            </button>
          ) : (
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
                onClick={submit}
                disabled={
                  saving ||
                  !online ||
                  createCheck.check.status !== "none"
                }
              >
                {saving ? "保存中" : "旅行をつくる"}
              </button>
            </>
          )
        }
      >
        {!online && <OfflineBanner at={null} />}
        {/* 保留があるあいだ（および確認自体が結果不明のとき）は
            「保存されたか確認できません」と「同じ内容で確認する」だけを出す。 */}
        {unknown && (
          <SaveUnknown
            onConfirm={() => void create.confirmWithSameRequest()}
          />
        )}
        {!unknown && pendingRecord !== null && (
          <SaveUnknown
            onConfirm={() =>
              void create
                .confirmRequest(pendingRecord)
                .then(createCheck.reload)
            }
            confirming={saving}
          />
        )}
        {storageUnavailable && <StorageUnavailable />}
        {state.status === "rejected" && (
          <StatusText tone="error">
            {state.code === "PARTICIPANTS_NOT_READY"
              ? "利用者の登録が確認できません。時間をおいてもう一度お試しください。"
              : "作成できませんでした。入力内容を確認してもう一度お試しください。"}
          </StatusText>
        )}
        {(!locked || lockedValues !== null) && (
          <TripFormFields
            values={locked ? (lockedValues ?? values) : values}
            errors={locked ? {} : errors}
            locked={fieldsLocked}
            fieldRefs={fieldRefs}
            onChange={onChange}
          />
        )}
      </Sheet>
    </>
  );
}
