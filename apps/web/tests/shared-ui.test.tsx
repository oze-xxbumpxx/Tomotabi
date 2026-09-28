import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Dialog } from "@/shared/ui/dialog";
import { Field } from "@/shared/ui/field";
import { Segmented } from "@/shared/ui/segmented";
import { Sheet } from "@/shared/ui/sheet";
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
