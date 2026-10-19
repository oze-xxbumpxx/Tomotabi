import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Dialog } from "@/shared/ui/dialog";
import { Field } from "@/shared/ui/field";
import { Segmented } from "@/shared/ui/segmented";
import { SHEET_CLOSE_MS, SHEET_DRAG_CLOSE_PX, Sheet } from "@/shared/ui/sheet";
import { Toast } from "@/shared/ui/toast";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Sheet", () => {
  it("見出し・内容・閉じるを出し、閉じるで onClose を呼ぶ", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <Sheet title="予定を追加" onClose={onClose}>
        <p>シートの中身</p>
      </Sheet>,
    );

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("予定を追加")).toBeInTheDocument();
    expect(screen.getByText("シートの中身")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "閉じる" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("Sheet の閉じる動き", () => {
  // jsdomにはPointerEventが無く、clientYを持たないEventになるので、MouseEventで代わりにする。
  if (typeof window.PointerEvent === "undefined") {
    class PointerEventShim extends MouseEvent {
      readonly pointerId: number;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 0;
      }
    }
    window.PointerEvent = PointerEventShim as unknown as typeof PointerEvent;
  }
  function allowMotion(reduce: boolean) {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: reduce, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    );
  }
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function renderSheet(onClose: () => void) {
    return render(
      <Sheet title="予定を追加" onClose={onClose}>
        <p>シートの中身</p>
      </Sheet>,
    );
  }

  it("閉じるを押すと下へ滑る動きを始め、終わってから onClose を呼ぶ", () => {
    allowMotion(false);
    const onClose = vi.fn();
    renderSheet(onClose);
    const dialog = screen.getByRole("dialog");

    fireEvent.click(screen.getByRole("button", { name: "閉じる" }));
    expect(dialog).toHaveAttribute("data-closing");
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.animationEnd(dialog);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("動きの終わりが届かなくても、打ち切りの時間で onClose を呼ぶ", () => {
    vi.useFakeTimers();
    allowMotion(false);
    const onClose = vi.fn();
    renderSheet(onClose);

    fireEvent.click(screen.getByRole("button", { name: "閉じる" }));
    act(() => {
      vi.advanceTimersByTime(SHEET_CLOSE_MS + 150);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("呼び出し側が閉じなかったら（保存中など）、元の位置に戻す", () => {
    vi.useFakeTimers();
    allowMotion(false);
    const onClose = vi.fn();
    renderSheet(onClose);
    const dialog = screen.getByRole("dialog");

    fireEvent.click(screen.getByRole("button", { name: "閉じる" }));
    fireEvent.animationEnd(dialog);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(dialog).not.toHaveAttribute("data-closing");
  });

  it("動きを減らす設定の端末では、すぐに onClose を呼ぶ", () => {
    allowMotion(true);
    const onClose = vi.fn();
    renderSheet(onClose);

    fireEvent.click(screen.getByRole("button", { name: "閉じる" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("見出しを指で十分に下へ引いて離すと閉じ、少しなら元に戻す", () => {
    vi.useFakeTimers();
    allowMotion(false);
    const onClose = vi.fn();
    renderSheet(onClose);
    const dialog = screen.getByRole("dialog");
    const grab = dialog.querySelector(".sheet-grab") as HTMLElement;

    // 少しだけ・ゆっくり引く → 戻る
    fireEvent.pointerDown(grab, { clientY: 100, timeStamp: 0, pointerId: 1 });
    fireEvent.pointerMove(grab, { clientY: 130, pointerId: 1 });
    expect(dialog.style.getPropertyValue("--sheet-drag")).toBe("30px");
    vi.advanceTimersByTime(1000);
    fireEvent.pointerUp(grab, { clientY: 130, timeStamp: 1000, pointerId: 1 });
    expect(dialog.style.getPropertyValue("--sheet-drag")).toBe("0px");
    expect(dialog).not.toHaveAttribute("data-closing");

    // 十分に引く → 閉じる動き
    fireEvent.pointerDown(grab, { clientY: 100, timeStamp: 2000, pointerId: 1 });
    fireEvent.pointerMove(grab, { clientY: 100 + SHEET_DRAG_CLOSE_PX + 10, pointerId: 1 });
    vi.advanceTimersByTime(2000);
    fireEvent.pointerUp(grab, { clientY: 100 + SHEET_DRAG_CLOSE_PX + 10, timeStamp: 4000, pointerId: 1 });
    expect(dialog).toHaveAttribute("data-closing");
    fireEvent.animationEnd(dialog);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("引いた量が少なくても、速く下へ払えば閉じる", () => {
    vi.useFakeTimers();
    allowMotion(false);
    renderSheet(vi.fn());
    const dialog = screen.getByRole("dialog");
    const grab = dialog.querySelector(".sheet-grab") as HTMLElement;

    fireEvent.pointerDown(grab, { clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(grab, { clientY: 160, pointerId: 1 });
    vi.advanceTimersByTime(60);
    fireEvent.pointerUp(grab, { clientY: 160, pointerId: 1 });
    expect(dialog).toHaveAttribute("data-closing");
  });
});

describe("Dialog", () => {
  it("見出しと内容を出し、フォーカスを内側へ移す", async () => {
    const onClose = vi.fn();
    render(
      <div>
        <button type="button">起点</button>
        <Dialog title="確認" onClose={onClose}>
          <button type="button">中のボタン</button>
        </Dialog>
      </div>,
    );

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("確認")).toBeInTheDocument();
    const dialog = screen.getByRole("dialog");
    await vi.waitFor(() =>
      expect(dialog.contains(document.activeElement)).toBe(true),
    );
  });

  it("中のボタンをキーボードで押しても閉じず、背景のクリックでだけ閉じる", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <Dialog title="確認" onClose={onClose}>
        <button type="button">中のボタン</button>
      </Dialog>,
    );

    const dialog = screen.getByRole("dialog");
    await vi.waitFor(() =>
      expect(dialog.contains(document.activeElement)).toBe(true),
    );
    await user.keyboard("{Enter}");
    expect(onClose).not.toHaveBeenCalled();

    vi.spyOn(dialog, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      right: 400,
      bottom: 300,
      width: 400,
      height: 300,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    fireEvent.click(dialog, { clientX: -10, clientY: -10 });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("Field", () => {
  it("可視ラベルと入力を関連付け、エラーを aria-describedby で結ぶ", () => {
    render(
      <Field
        label="名前"
        value="京都"
        onChange={() => undefined}
        error="名前を入力してください"
      />,
    );

    const input = screen.getByLabelText("名前");
    const error = screen.getByRole("alert");
    expect(error).toHaveTextContent("名前を入力してください");
    expect(input).toHaveAttribute("aria-describedby", error.id);
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  it("locked の入力は readOnly で固定色の印になる", () => {
    render(<Field label="名前" value="固定" onChange={() => undefined} locked />);

    const input = screen.getByLabelText("名前");
    expect(input).toHaveAttribute("readonly");
    expect(input).toHaveAttribute("aria-disabled", "true");
  });

  it("optional のとき任意を出す", () => {
    render(
      <Field label="メモ" value="" onChange={() => undefined} optional />,
    );

    expect(screen.getByText("任意")).toBeInTheDocument();
  });
});

describe("Segmented", () => {
  function TwoChoices({ locked = false }: { locked?: boolean }) {
    const [value, setValue] = useState<string | null>("left");
    return (
      <Segmented
        label="払った人"
        options={[
          { value: "left", label: "ひなた" },
          { value: "right", label: "あおい" },
        ]}
        value={value}
        onChange={setValue}
        locked={locked}
      />
    );
  }

  it("選択した値を onChange に渡す", async () => {
    const user = userEvent.setup();
    render(<TwoChoices />);

    const other = screen.getByRole("radio", { name: "あおい" });
    await user.click(other);
    expect(other).toBeChecked();
    expect(screen.getByRole("radio", { name: "ひなた" })).not.toBeChecked();
  });

  it("locked は選び直せない", async () => {
    const user = userEvent.setup();
    render(<TwoChoices locked />);

    const other = screen.getByRole("radio", { name: "あおい" });
    expect(other).toBeDisabled();
    await user.click(other);
    expect(screen.getByRole("radio", { name: "ひなた" })).toBeChecked();
  });
});

describe("Toast", () => {
  it("上部のステータスとして出て、時間で消える", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<Toast message="保存しました" onDismiss={onDismiss} />);

    expect(screen.getByRole("status")).toHaveTextContent("保存しました");
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("呼び出し側の再描画でタイマーをやり直さない", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const { rerender } = render(
      <Toast message="保存しました" onDismiss={onDismiss} />,
    );

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    rerender(<Toast message="保存しました" onDismiss={() => onDismiss()} />);
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
