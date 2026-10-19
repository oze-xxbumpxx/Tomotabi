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
  /**
   * いま閉じてよいか（既定はtrue）。保存中・結果不明のあいだはfalseにする。
   * falseのあいだは閉じる動きを始めず、引いたシートは元の位置に戻す。
   */
  closable?: boolean;
};

/** 閉じる動き（CSSの`sheet-out`）の長さ。animationendが来なかったときの打ち切りにも使う。 */
export const SHEET_CLOSE_MS = 250;
/** これより下へ引いて離したら閉じる。 */
export const SHEET_DRAG_CLOSE_PX = 96;
/** これより速く下へ払ったら、引いた量が少なくても閉じる（px/ms）。 */
const SHEET_FLICK_VELOCITY = 0.5;
/** 払いの速さは、指を離す直前のこの時間の動きで測る（押したまま止めていた時間で薄めない）。 */
const SHEET_FLICK_WINDOW_MS = 100;

/** 動きを付けてよいか。動きを減らす設定の端末と、matchMediaが無い環境では付けない（v3の決まり）。 */
function motionAllowed(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

type Sample = { offset: number; time: number };
type Drag = { startY: number; offset: number; samples: Sample[] };

export function Sheet({
  title,
  onClose,
  children,
  footer,
  initialFocus,
  closable = true,
}: SheetProps) {
  const dialogRef = useModalDialog(initialFocus);
  const titleId = useId();
  const [closing, setClosing] = useState(false);
  const drag = useRef<Drag | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finished = useRef(false);

  useEffect(
    () => () => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
      }
    },
    [],
  );

  const setOffset = (offset: number) => {
    dialogRef.current?.style.setProperty("--sheet-drag", `${offset}px`);
  };

  // 閉じる動きが終わってから呼び出し側に閉じてもらう。閉じてよいかは`closable`で
  // 先に決めているので、ここでは戻さない（画面を移って閉じるとき、移り終わるまで
  // シートが戻ってこないように）。
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
  }, [onClose]);

  const requestClose = useCallback(() => {
    if (closing) {
      return;
    }
    if (!closable) {
      // 閉じられないあいだは、引いたシートを元の位置に戻すだけにする。
      setOffset(0);
      return;
    }
    if (!motionAllowed()) {
      setOffset(0);
      onClose();
      return;
    }
    finished.current = false;
    setClosing(true);
    timer.current = setTimeout(finishClose, SHEET_CLOSE_MS + 150);
  }, [closable, closing, finishClose, onClose]);

  const onGrabDown = (event: PointerEvent<HTMLDivElement>) => {
    // 閉じるボタンの押下は引く操作として扱わない。
    if (closing || (event.target as HTMLElement).closest("button") !== null) {
      return;
    }
    drag.current = {
      startY: event.clientY,
      offset: 0,
      samples: [{ offset: 0, time: Date.now() }],
    };
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
    const now = Date.now();
    current.samples.push({ offset: current.offset, time: now });
    current.samples = current.samples.filter(
      (sample) => now - sample.time <= SHEET_FLICK_WINDOW_MS,
    );
    setOffset(current.offset);
  };

  const endDrag = (): Drag | null => {
    const current = drag.current;
    drag.current = null;
    dialogRef.current?.removeAttribute("data-dragging");
    return current;
  };

  const onGrabUp = () => {
    const current = endDrag();
    if (current === null) {
      return;
    }
    const now = Date.now();
    const recent = current.samples.filter(
      (sample) => now - sample.time <= SHEET_FLICK_WINDOW_MS,
    );
    const first = recent[0];
    const velocity =
      first === undefined
        ? 0
        : (current.offset - first.offset) / Math.max(1, now - first.time);
    if (current.offset >= SHEET_DRAG_CLOSE_PX || velocity >= SHEET_FLICK_VELOCITY) {
      requestClose();
      return;
    }
    // 足りなければ元の位置へ戻す（CSSのtransitionで戻る）。
    setOffset(0);
  };

  // 端末が操作を中断したとき（pointercancel）は、利用者が離したのではないので閉じない。
  const onGrabCancel = () => {
    if (endDrag() !== null) {
      setOffset(0);
    }
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
        onPointerCancel={onGrabCancel}
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
