"use client";

import { Warning } from "@phosphor-icons/react";
import { useId, type ReactNode, type Ref } from "react";

export type SegmentedOption = {
  value: string;
  label: string;
  icon?: ReactNode;
};

type SegmentedProps = {
  label: string;
  optional?: boolean;
  options: SegmentedOption[];
  value: string | null;
  onChange: (value: string) => void;
  /** 固定した選択（C-4・種類変更が不可のとき）。選び直せなくする。 */
  locked?: boolean;
  error?: string | null;
  columns?: 1 | 2;
  /** エラー欄へフォーカスを戻すための fieldset 参照。 */
  ref?: Ref<HTMLFieldSetElement>;
};

export function Segmented({
  label,
  optional = false,
  options,
  value,
  onChange,
  locked = false,
  error = null,
  columns = 1,
  ref,
}: SegmentedProps) {
  const name = useId();
  const errorId = `${name}-error`;
  const hasError = error !== null && error !== undefined;

  return (
    <fieldset
      ref={ref}
      tabIndex={ref !== undefined ? -1 : undefined}
      className="segmented"
      aria-invalid={hasError || undefined}
      aria-describedby={hasError ? errorId : undefined}
    >
      <legend className="segmented-label">
        {label}
        {optional ? <span className="field-optional">任意</span> : null}
      </legend>
      <div
        className={
          columns === 2 ? "segmented-grid segmented-grid-2" : "segmented-grid"
        }
      >
        {options.map((option) => (
          <label key={option.value} className="segmented-option">
            <input
              type="radio"
              className="sr-only"
              name={name}
              value={option.value}
              checked={option.value === value}
              disabled={locked}
              onChange={() => onChange(option.value)}
            />
            {option.icon}
            <span>{option.label}</span>
          </label>
        ))}
      </div>
      {hasError ? (
        <p className="field-error" id={errorId} role="alert">
          <Warning size={15} weight="bold" aria-hidden="true" />
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
