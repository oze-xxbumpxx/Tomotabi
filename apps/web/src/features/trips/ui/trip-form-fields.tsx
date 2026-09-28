"use client";

import type { RefObject } from "react";
import { Field } from "@/shared/ui/field";
import type {
  TripFormErrors,
  TripFormField,
  TripFormValues,
} from "../model/trip-form";

/**
 * 旅行の作成・変更フォームの入力欄（旅行名・開始日・終了日）。
 * 日付は `<input type="date">`（端末標準のピッカー）。
 */
export function TripFormFields({
  values,
  errors,
  locked = false,
  fieldRefs,
  onChange,
}: {
  values: TripFormValues;
  errors: TripFormErrors;
  locked?: boolean;
  fieldRefs: Record<TripFormField, RefObject<HTMLInputElement | null>>;
  onChange: (field: TripFormField, value: string) => void;
}) {
  return (
    <div className="trip-form">
      <Field
        label="旅行名"
        value={values.name}
        onChange={(event) => onChange("name", event.target.value)}
        error={errors.name ?? null}
        locked={locked}
        ref={fieldRefs.name}
        autoComplete="off"
      />
      <Field
        label="開始日"
        type="date"
        value={values.startsOn}
        onChange={(event) => onChange("startsOn", event.target.value)}
        error={errors.startsOn ?? null}
        locked={locked}
        ref={fieldRefs.startsOn}
      />
      <Field
        label="終了日"
        type="date"
        value={values.endsOn}
        onChange={(event) => onChange("endsOn", event.target.value)}
        error={errors.endsOn ?? null}
        locked={locked}
        ref={fieldRefs.endsOn}
      />
    </div>
  );
}
