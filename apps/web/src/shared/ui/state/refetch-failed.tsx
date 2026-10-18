import { ArrowsClockwise, Clock } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

/** 再取得がこの時間より短ければ「更新中」を出さない（設計書 screen-speed のSS-03）。 */
export const REFETCHING_DELAY_MS = 500;

/**
 * 再取得中の札。再取得のあいだだけ置く（呼び出し側は`isRefetching`のときに描く）。
 * 置いてから0.5秒たってから見せ、画面の上に重ねるので中身の並びは動かない。
 */
export function Refetching({ label = "更新中" }: { label?: string }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), REFETCHING_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);
  if (!visible) {
    return null;
  }
  return (
    <span className="refetching" role="status">
      <ArrowsClockwise
        size={13}
        weight="bold"
        className="icon-spin"
        aria-hidden="true"
      />
      {label}
    </span>
  );
}

function formatTime(date: Date): string {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

/**
 * 再取得の失敗。`fetchedAt`は「表示中の内容」の取得時刻（失敗した時刻ではない）。
 * 前回の表示は呼び出し側が残したまま、この部品を添える。
 */
export function RefetchFailed({
  fetchedAt,
  onRetry,
}: {
  fetchedAt: Date;
  onRetry: () => void;
}) {
  return (
    <div className="refetch-failed">
      <span className="refetch-failed-badge">
        <Clock size={13} weight="bold" aria-hidden="true" />
        {`更新できていません · ${formatTime(fetchedAt)} 時点`}
      </span>
      <button type="button" className="btn-secondary" onClick={onRetry}>
        再試行
      </button>
    </div>
  );
}
