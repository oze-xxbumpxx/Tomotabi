"use client";

import type { RefObject } from "react";
import type { PlanKind } from "@tomotabi/contracts";
import { Field } from "@/shared/ui/field";
import { FieldTextarea } from "@/shared/ui/field";
import { Segmented, type SegmentedOption } from "@/shared/ui/segmented";
import {
  firstInvalidField,
  type PlanFormErrors,
  type PlanFormField,
  type PlanFormValues,
} from "../model/plan-form";
import { PLAN_KIND_LABEL, PLAN_KINDS, PlanKindIcon } from "./plan-kind-icon";
import { DatePickerGrid } from "./date-picker-grid";

export type PlanFormChange =
  | { field: "name" | "date" | "time" | "memo"; value: string }
  | { field: "kind"; value: PlanKind }
  | { field: "timeUndecided"; value: boolean };

const KIND_OPTIONS: SegmentedOption[] = PLAN_KINDS.map((kind) => ({
  value: kind,
  label: PLAN_KIND_LABEL[kind],
  icon: <PlanKindIcon kind={kind} size={18} />,
}));

/**
 * 予定の追加・編集フォームの入力欄。名前・種類（2列のアイコン付き選択）・
 * 日付（追加のみ、11cの3等分選択）・時刻（「時刻未定」の切り替え +
 * `<input type="time">`）・メモ。種類を変えられないときは選択を固定して
 * 理由の文を出す（W-19）。
 */
export function PlanFormFields({
  values,
  errors,
  locked = false,
  period = null,
  kindLockedReason = null,
  fieldRefs,
  kindRef,
  onChange,
}: {
  values: PlanFormValues;
  errors: PlanFormErrors;
  /** 送信中・結果不明のあいだは欄全体を固定する（C-4）。 */
  locked?: boolean;
  /** 追加フォームでは旅行期間を渡す（編集は日付欄を出さない）。 */
  period?: { startsOn: string; endsOn: string } | null;
  /** 種類が変えられないときの理由文（record_history_exists）。 */
  kindLockedReason?: string | null;
  fieldRefs: Partial<
    Record<PlanFormField, RefObject<HTMLInputElement | null>>
  >;
  /** 種類のエラー時にフォーカスを戻すfieldset参照。 */
  kindRef?: RefObject<HTMLFieldSetElement | null>;
  onChange: (change: PlanFormChange) => void;
}) {
  const kindLocked = kindLockedReason !== null || locked;
  return (
    <div className="trip-form">
      <Field
        label="名前"
        value={values.name}
        onChange={(event) =>
          onChange({ field: "name", value: event.target.value })
        }
        error={errors.name ?? null}
        locked={locked}
        ref={fieldRefs.name}
        autoComplete="off"
      />
      <div className="field">
        <Segmented
          ref={kindRef}
          label="種類"
          options={KIND_OPTIONS}
          value={values.kind}
          onChange={(kind) =>
            onChange({ field: "kind", value: kind as PlanKind })
          }
          columns={2}
          locked={kindLocked}
          error={errors.kind ?? null}
        />
        {kindLockedReason !== null && (
          <p className="plan-field-note">{kindLockedReason}</p>
        )}
      </div>
      {period !== null && (
        <div className="field">
          <span className="field-label">日付</span>
          <DatePickerGrid
            startsOn={period.startsOn}
            endsOn={period.endsOn}
            value={values.date === "" ? null : values.date}
            disabled={locked}
            onSelect={(date) => onChange({ field: "date", value: date })}
          />
          {errors.date !== undefined && (
            <p className="field-error" role="alert">
              {errors.date}
            </p>
          )}
        </div>
      )}
      <div className="field">
        <span className="field-label">時刻</span>
        <label className="plan-time-toggle">
          <input
            type="checkbox"
            checked={values.timeUndecided}
            disabled={locked}
            aria-label="時刻未定"
            onChange={(event) =>
              onChange({
                field: "timeUndecided",
                value: event.target.checked,
              })
            }
          />
          時刻未定
        </label>
        {!values.timeUndecided && (
          <input
            type="time"
            className="field-input"
            aria-label="時刻"
            value={values.time}
            readOnly={locked}
            aria-disabled={locked || undefined}
            aria-invalid={errors.time !== undefined ? true : undefined}
            data-locked={locked || undefined}
            ref={fieldRefs.time}
            onChange={(event) =>
              onChange({ field: "time", value: event.target.value })
            }
          />
        )}
        {errors.time !== undefined && (
          <p className="field-error" role="alert">
            {errors.time}
          </p>
        )}
      </div>
      <FieldTextarea
        label="メモ"
        optional
        value={values.memo}
        onChange={(event) =>
          onChange({ field: "memo", value: event.target.value })
        }
        error={errors.memo ?? null}
        locked={locked}
      />
    </div>
  );
}

export { firstInvalidField };
