import { CalendarCheck, CheckCircle } from "@phosphor-icons/react";
import { Dialog } from "@/shared/ui/dialog";

/** 達成・予約の説明の一行。予定の詳細の操作の欄と確認で同じ文を使う（#252）。 */
export const RECORD_NOTES = {
  achievement: "行った・食べた・買ったら押します。相手に通知が届きます。",
  booking:
    "このアプリの中の印です。お店の予約は変わりません。相手に通知が届きます。",
} as const;

/**
 * 達成・予約を付ける前の確認（#252）。押すと保存と相手への通知が
 * 同時に起き、通知は取り消せないので、保存の前に1回止める。
 * 保存の状態（保存中・結果不明・拒否）は呼び出し側の画面で出すので、
 * ここでは聞くだけにし、決定で閉じてから保存する。
 */
export function ConfirmRecordDialog({
  kind,
  planName,
  online,
  onConfirm,
  onClose,
}: {
  kind: "achievement" | "booking";
  planName: string;
  online: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const achievement = kind === "achievement";
  const Icon = achievement ? CheckCircle : CalendarCheck;
  return (
    <Dialog
      title={
        achievement
          ? `${planName}を達成にしますか？`
          : `${planName}の予約を記録しますか？`
      }
      onClose={onClose}
    >
      <p className="dialog-body">
        {achievement ? "相手に通知が届きます。" : RECORD_NOTES.booking}
      </p>
      <div className="dialog-actions">
        <button type="button" className="btn-secondary" onClick={onClose}>
          やめる
        </button>
        <button
          type="button"
          className="btn-primary"
          onClick={onConfirm}
          disabled={!online}
        >
          <Icon size={16} weight="fill" aria-hidden="true" />
          {achievement ? "達成を記録" : "予約を記録"}
        </button>
      </div>
    </Dialog>
  );
}
