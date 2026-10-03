import { Warning } from "@phosphor-icons/react";

export type ConflictRow = {
  label: string;
  mine: string;
  /** 違いがある項目だけ最新の値。nullは違いなし（1行で表示）。 */
  latest: string | null;
};

/**
 * C-5競合。違いのある項目ごとに「最新（相手）」と「あなたの入力」を並べ、
 * 違いのない項目は1行で出す。`onSaveMine`は最新のETagと新しいキーでの送信、
 * `onUseLatest`はフォームを最新の内容で置き換える操作に繋ぐ。
 */
export function ConflictNotice({
  rows,
  otherName = "相手",
  onSaveMine,
  onUseLatest,
  saving = false,
}: {
  rows: ConflictRow[];
  otherName?: string;
  onSaveMine: () => void;
  onUseLatest: () => void;
  saving?: boolean;
}) {
  return (
    <div className="conflict">
      <div className="banner banner-warning" role="alert">
        <Warning size={18} weight="bold" className="banner-icon" aria-hidden="true" />
        <div className="banner-text">
          <span className="banner-title">相手が先に変更しました</span>
          <span className="banner-body">
            あなたの入力は消えていません。見比べてから保存してください。
          </span>
        </div>
      </div>
      <ul className="conflict-list">
        {rows.map((row) => (
          <li key={row.label} className="conflict-row">
            <div className="conflict-row-head">
              <span className="conflict-row-label">{row.label}</span>
              <span
                className={
                  row.latest === null ? "conflict-same" : "conflict-diff"
                }
              >
                {row.latest === null ? "変更なし" : "変更あり"}
              </span>
            </div>
            {row.latest === null ? (
              <span className="conflict-value">{row.mine}</span>
            ) : (
              <div className="conflict-compare">
                <span className="conflict-side">{`最新（${otherName}）`}</span>
                <span className="conflict-value">{row.latest}</span>
                <span className="conflict-side conflict-side-mine">
                  あなたの入力
                </span>
                <span className="conflict-value conflict-value-mine">
                  {row.mine}
                </span>
              </div>
            )}
          </li>
        ))}
      </ul>
      <p className="conflict-note">
        「あなたの入力で保存」を押すと、違いのある項目はあなたの入力に置き換わります。
      </p>
      <div className="conflict-actions">
        <button
          type="button"
          className="btn-ink"
          onClick={onSaveMine}
          disabled={saving}
        >
          あなたの入力で保存
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={onUseLatest}
          disabled={saving}
        >
          最新の内容で入力し直す
        </button>
      </div>
    </div>
  );
}
