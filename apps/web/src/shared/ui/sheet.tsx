"use client";

import { X } from "@phosphor-icons/react";
import { useId, type ReactNode, type RefObject } from "react";
import { isBackdropClick, useModalDialog } from "./use-modal-dialog";

type SheetProps = {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** 開いたときにフォーカスする要素（指定が無ければ先頭の要素）。 */
  initialFocus?: RefObject<HTMLElement | null>;
};

export function Sheet({
  title,
  onClose,
  children,
  footer,
  initialFocus,
}: SheetProps) {
  const dialogRef = useModalDialog(initialFocus);
  const titleId = useId();

  return (
    <dialog
      ref={dialogRef}
      className="sheet"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (isBackdropClick(event)) {
          onClose();
        }
      }}
    >
      <div className="sheet-handle" aria-hidden="true" />
      <div className="sheet-head">
        <h2 className="sheet-title" id={titleId}>
          {title}
        </h2>
        <button
          type="button"
          className="icon-button"
          onClick={onClose}
          aria-label="閉じる"
        >
          <X size={18} weight="bold" aria-hidden="true" />
        </button>
      </div>
      <div className="sheet-body">{children}</div>
      {footer !== undefined && footer !== null ? (
        <div className="sheet-footer">{footer}</div>
      ) : null}
    </dialog>
  );
}
