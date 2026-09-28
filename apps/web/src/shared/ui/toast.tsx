"use client";

import { Check } from "@phosphor-icons/react";
import { useEffect } from "react";

type ToastProps = {
  message: string;
  onDismiss: () => void;
  durationMs?: number;
};

export function Toast({ message, onDismiss, durationMs = 2000 }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, durationMs);
    return () => clearTimeout(timer);
  }, [durationMs, onDismiss]);

  return (
    <div className="toast" role="status">
      <Check size={16} weight="bold" aria-hidden="true" />
      {message}
    </div>
  );
}
