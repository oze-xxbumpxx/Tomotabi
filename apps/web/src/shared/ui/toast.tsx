"use client";

import { Check } from "@phosphor-icons/react";
import { useEffect, useRef } from "react";

type ToastProps = {
  message: string;
  onDismiss: () => void;
  durationMs?: number;
};

export function Toast({ message, onDismiss, durationMs = 2000 }: ToastProps) {
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  useEffect(() => {
    const timer = setTimeout(() => onDismissRef.current(), durationMs);
    return () => clearTimeout(timer);
  }, [durationMs]);

  return (
    <div className="toast" role="status">
      <Check size={16} weight="bold" aria-hidden="true" />
      {message}
    </div>
  );
}
