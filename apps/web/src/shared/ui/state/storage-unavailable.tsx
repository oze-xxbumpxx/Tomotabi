import { Warning } from "@phosphor-icons/react";

/**
 * F-53: IndexedDB（結果不明の要求を残す領域）が使えないときの案内。
 * 送る前の保存ができなかったので、要求はまだ送られていない。
 * 黙ってメモリだけの保存に切り替えない。
 */
export function StorageUnavailable() {
  return (
    <div className="banner banner-danger" role="alert">
      <Warning
        size={18}
        weight="bold"
        className="banner-icon"
        aria-hidden="true"
      />
      <div className="banner-text">
        <span className="banner-title">
          この端末では保存の確認に使う領域が使えません
        </span>
        <span className="banner-body">
          まだ保存は送られていません。端末の設定やブラウザのモードを見直してから、もう一度お試しください。
        </span>
      </div>
    </div>
  );
}
