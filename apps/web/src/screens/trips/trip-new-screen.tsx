"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import {
  createTripDraft,
  firstInvalidField,
  TripFormFields,
  useCreateTrip,
  validateTripForm,
  type TripFormErrors,
  type TripFormField,
  type TripFormValues,
} from "@/features/trips";
import { Sheet } from "@/shared/ui/sheet";
import { OfflineBanner } from "@/shared/ui/state/offline-banner";
import { SaveUnknown } from "@/shared/ui/state/save-unknown";
import { SessionExpired } from "@/shared/ui/state/session-expired";
import { useOnlineStatus } from "@/shared/ui/state/use-online-status";
import { StatusText } from "@/shared/ui/status-text";

/**
 * `/trips/new` の旅行の作成。v3 に無い画面のため、11「支払いを記録」と
 * 同じシートの形（上端の角丸 xl・見出し・閉じる・下端に主ボタン）で組む。
 * 成功したら作った旅行のしおりへ移る（選択値の保存はしおり側で行う）。
 */
export function TripNewScreen() {
  const router = useRouter();
  const online = useOnlineStatus();
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

  const create = useCreateTrip({
    onSucceeded: (result) => {
      router.replace(`/trips/${result.data.id}/itinerary`);
    },
  });

  const onChange = (field: TripFormField, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    create.backToEditing();
  };

  const submit = () => {
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

  return (
    <main>
      <Sheet
        title="新しい旅行"
        onClose={tryClose}
        footer={
          unknown ? null : (
            <button
              type="button"
              className="btn-primary"
              onClick={submit}
              disabled={saving || !online}
            >
              {saving ? "保存中" : "旅行をつくる"}
            </button>
          )
        }
      >
        {!online && <OfflineBanner at={null} />}
        {unknown && (
          <SaveUnknown
            onConfirm={() => void create.confirmWithSameRequest()}
          />
        )}
        {state.status === "rejected" && (
          <StatusText tone="error">
            {state.code === "PARTICIPANTS_NOT_READY"
              ? "利用者の登録が確認できません。時間をおいてもう一度お試しください。"
              : "作成できませんでした。入力内容を確認してもう一度お試しください。"}
          </StatusText>
        )}
        <TripFormFields
          values={values}
          errors={errors}
          locked={saving || unknown}
          fieldRefs={fieldRefs}
          onChange={onChange}
        />
      </Sheet>
    </main>
  );
}
