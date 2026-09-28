import { useEffect, useRef, type MouseEvent } from "react";

/**
 * `<dialog>` をモーダルとして開く。開いているあいだフォーカスは内側にあり、
 * 閉じたら開く直前にフォーカスしていた要素へ戻す。
 */
export function useModalDialog() {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (element === null) {
      return;
    }
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    try {
      element.showModal();
    } catch {
      element.setAttribute("open", "");
    }
    if (!element.contains(document.activeElement)) {
      const focusable = element.querySelector<HTMLElement>(
        "button, [href], input, select, textarea, [tabindex]",
      );
      (focusable ?? element).focus();
    }
    return () => {
      if (previous !== null && document.contains(previous)) {
        previous.focus();
      }
    };
  }, []);

  return ref;
}

export function isBackdropClick(
  event: MouseEvent<HTMLDialogElement>,
): boolean {
  const rect = event.currentTarget.getBoundingClientRect();
  return (
    event.clientX < rect.left ||
    event.clientX > rect.right ||
    event.clientY < rect.top ||
    event.clientY > rect.bottom
  );
}
