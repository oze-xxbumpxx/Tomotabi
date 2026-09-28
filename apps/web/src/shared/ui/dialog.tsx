"use client";

import { useId, type ReactNode } from "react";
import { isBackdropClick, useModalDialog } from "./use-modal-dialog";

type DialogProps = {
  title: string;
  onClose: () => void;
  children: ReactNode;
};

export function Dialog({ title, onClose, children }: DialogProps) {
  const dialogRef = useModalDialog();
  const titleId = useId();

  return (
    <dialog
      ref={dialogRef}
      className="dialog"
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
      <h2 className="dialog-title" id={titleId}>
        {title}
      </h2>
      {children}
    </dialog>
  );
}
