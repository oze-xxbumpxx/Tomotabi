"use client";

import { X } from "@phosphor-icons/react";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { isBackdropClick, useModalDialog } from "./use-modal-dialog";

type SheetProps = {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** 開いたときにフォーカスする要素（指定が無ければ先頭の要素）。 */
  initialFocus?: RefObject<HTMLElement | null>;
};

/** 閉じる動き（CSSの`sheet-out`）の長さ。animationendが来なかったときの打ち切りにも使う。 */
export const SHEET_CLOSE_MS = 250;
/** これより下へ引いて離したら閉じる。 */
export const SHEET_DRAG_CLOSE_PX = 96;
/** これより速く下へ払ったら、引いた量が少なくても閉じる（px/ms）。 */
const SHEET_FLICK_VELOCITY = 0.5;

/** 動きを付けてよいか。動きを減らす設定の端末と、matchMediaが無い環境では付けない（v3の決まり）。 */
function motionAllowed(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

type Drag = { startY: number; startTime: number; offset: number };

export function Sheet({
  title,
  onClose,
  children,
  footer,
  initialFocus,
}: SheetProps) {
  const dialogRef = useModalDialog(initialFocus);
  const titleId = useId();
  const [closing, setClosing] = useState(false);
  const drag = useRef<Drag | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finished = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current !== null) {
        clearTimeout(timer.current);
      }
    };
  }, []);

  const setOffset = (offset: number) => {
    dialogRef.current?.style.setProperty("--sheet-drag", `${offset}px`);
  };

  // 閉じる動きが終わってから呼び出し側に閉じてもらう。呼び出し側が閉じなかったとき
  // （保存中で閉じられないなど）は、シートを元の位置に戻す。
  const finishClose = useCallback(() => {
    if (finished.current) {
      return;
    }
    finished.current = true;
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    onClose();
    setTimeout(() => {
      if (mounted.current) {
        finished.current = false;
        setOffset(0);
        setClosing(false);
      }
    }, 0);
  }, [onClose]);

  const requestClose = useCallback(() => {
    if (closing) {
      return;
    }
    if (!motionAllowed()) {
      onClose();
      return;
    }
    finished.current = false;
    setClosing(true);
    timer.current = setTimeout(finishClose, SHEET_CLOSE_MS + 150);
  }, [closing, finishClose, onClose]);

  const onGrabDown = (event: PointerEvent<HTMLDivElement>) => {
    // 閉じるボタンの押下は引く操作として扱わない。
    if (closing || (event.target as HTMLElement).closest("button") !== null) {
      return;
    }
    drag.current = { startY: event.clientY, startTime: Date.now(), offset: 0 };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dialogRef.current?.setAttribute("data-dragging", "");
  };

  const onGrabMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (current === null) {
      return;
    }
    // 上へは動かさない（シートは画面の下に付いている）。
    current.offset = Math.max(0, event.clientY - current.startY);
    setOffset(current.offset);
  };

  const onGrabUp = () => {
    const current = drag.current;
    if (current === null) {
      return;
    }
    drag.current = null;
    dialogRef.current?.removeAttribute("data-dragging");
    const elapsed = Math.max(1, Date.now() - current.startTime);
    const velocity = current.offset / elapsed;
    if (current.offset >= SHEET_DRAG_CLOSE_PX || velocity >= SHEET_FLICK_VELOCITY) {
      requestClose();
      return;
    }
    // 足りなければ元の位置へ戻す（CSSのtransitionで戻る）。
    setOffset(0);
  };

  return (
    <dialog
      ref={dialogRef}
      className="sheet"
      aria-labelledby={titleId}
      data-closing={closing ? "" : undefined}
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
      onClick={(event) => {
        if (isBackdropClick(event)) {
          requestClose();
        }
      }}
      onAnimationEnd={(event) => {
        if (closing && event.target === event.currentTarget) {
          finishClose();
        }
      }}
    >
      <div
        className="sheet-grab"
        onPointerDown={onGrabDown}
        onPointerMove={onGrabMove}
        onPointerUp={onGrabUp}
        onPointerCancel={onGrabUp}
      >
        <div className="sheet-handle" aria-hidden="true" />
        <div className="sheet-head">
          <h2 className="sheet-title" id={titleId}>
            {title}
          </h2>
          <button
            type="button"
            className="icon-button"
            onClick={requestClose}
            aria-label="閉じる"
          >
            <X size={18} weight="bold" aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="sheet-body">{children}</div>
      {footer !== undefined && footer !== null ? (
        <div className="sheet-footer">{footer}</div>
      ) : null}
    </dialog>
  );
}
