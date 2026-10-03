import { ArrowsClockwise, Warning } from "@phosphor-icons/react";

/**
 * C-4保存の結果が不明。入力欄は呼び出し側が`locked`にして固定し、
 * この部品の「同じ内容で確認する」で同じ要求だけを送り直す
 * （別の入力で保存し直さない）。送り直せるのは固定した同じ要求だけ。
 */
export function SaveUnknown({
  onConfirm,
  confirming = false,
}: {
  onConfirm: () => void;
  confirming?: boolean;
}) {
  return (
    <div className="save-unknown">
      <div className="banner banner-danger" role="alert">
        <Warning size={18} weight="bold" className="banner-icon" aria-hidden="true" />
        <div className="banner-text">
          <span className="banner-title">保存されたか確認できません</span>
          <span className="banner-body">
            入力はそのまま残しています。別の内容で保存し直さず、「同じ内容で確認する」で保存状態を確かめてください。
          </span>
        </div>
      </div>
      <button
        type="button"
        className="btn-ink"
        onClick={onConfirm}
        disabled={confirming}
      >
        <ArrowsClockwise size={16} weight="bold" aria-hidden="true" />
        {confirming ? "確認中" : "同じ内容で確認する"}
      </button>
    </div>
  );
}
