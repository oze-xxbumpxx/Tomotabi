import {
  useEffect,
  useRef,
  type MouseEvent,
  type RefObject,
} from "react";

/**
 * `<dialog>`をモーダルとして開く。開いているあいだフォーカスは内側にあり、
 * 閉じたら開く直前にフォーカスしていた要素へ戻す。
 * `initialFocus`を渡すと、開いたときのフォーカスは先頭の要素ではなく
 * その要素に移る（フォームのシートは最初の入力欄へ）。
 */
export function useModalDialog(
  initialFocus?: RefObject<HTMLElement | null>,
) {
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
      (initialFocus?.current ?? focusable ?? element).focus();
    }
    return () => {
      if (previous !== null && document.contains(previous)) {
        previous.focus();
      }
    };
  }, [initialFocus]);

  return ref;
}

export function isBackdropClick(
  event: MouseEvent<HTMLDialogElement>,
): boolean {
  // 中の要素（ボタンなど）へのクリック・キーボード操作は背景のクリックとみなさない。
  if (event.target !== event.currentTarget) {
    return false;
  }
  const rect = event.currentTarget.getBoundingClientRect();
  return (
    event.clientX < rect.left ||
    event.clientX > rect.right ||
    event.clientY < rect.top ||
    event.clientY > rect.bottom
  );
}
