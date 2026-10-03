"use client";

import { Warning } from "@phosphor-icons/react";
import {
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
  type TextareaHTMLAttributes,
} from "react";

type ShellProps = {
  label: string;
  optional?: boolean;
  error?: string | null;
  htmlFor: string;
  errorId: string;
  children: ReactNode;
};

function FieldShell({
  label,
  optional,
  error,
  htmlFor,
  errorId,
  children,
}: ShellProps) {
  return (
    <div className="field">
      <label
        className={error !== null && error !== undefined ? "field-label field-label-error" : "field-label"}
        htmlFor={htmlFor}
      >
        {label}
        {optional === true ? (
          <span className="field-optional">任意</span>
        ) : null}
      </label>
      {children}
      {error !== null && error !== undefined ? (
        <p className="field-error" id={errorId} role="alert">
          <Warning size={15} weight="bold" aria-hidden="true" />
          {error}
        </p>
      ) : null}
    </div>
  );
}

type FieldProps = {
  label: string;
  optional?: boolean;
  error?: string | null;
  /** 固定した入力（C-4）。readOnlyになり、見た目も固定色になる。 */
  locked?: boolean;
  /** エラーの欄へフォーカスを移すなど、input要素への参照。 */
  ref?: Ref<HTMLInputElement>;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "id">;

export function Field({
  label,
  optional = false,
  error = null,
  locked = false,
  className,
  ...inputProps
}: FieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <FieldShell
      label={label}
      optional={optional}
      error={error}
      htmlFor={id}
      errorId={errorId}
    >
      <input
        {...inputProps}
        id={id}
        className={
          className !== undefined
            ? `field-input ${className}`
            : "field-input"
        }
        readOnly={locked || inputProps.readOnly}
        aria-disabled={locked || undefined}
        aria-invalid={error !== null && error !== undefined ? true : undefined}
        aria-describedby={
          error !== null && error !== undefined ? errorId : undefined
        }
        data-locked={locked || undefined}
      />
    </FieldShell>
  );
}

type FieldTextareaProps = {
  label: string;
  optional?: boolean;
  error?: string | null;
  locked?: boolean;
} & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id">;

export function FieldTextarea({
  label,
  optional = false,
  error = null,
  locked = false,
  className,
  ...textProps
}: FieldTextareaProps) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <FieldShell
      label={label}
      optional={optional}
      error={error}
      htmlFor={id}
      errorId={errorId}
    >
      <textarea
        {...textProps}
        id={id}
        className={
          className !== undefined
            ? `field-textarea ${className}`
            : "field-textarea"
        }
        readOnly={locked || textProps.readOnly}
        aria-disabled={locked || undefined}
        aria-invalid={error !== null && error !== undefined ? true : undefined}
        aria-describedby={
          error !== null && error !== undefined ? errorId : undefined
        }
        data-locked={locked || undefined}
      />
    </FieldShell>
  );
}
