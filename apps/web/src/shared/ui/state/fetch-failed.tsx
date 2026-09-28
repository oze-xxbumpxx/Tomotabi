import { Warning } from "@phosphor-icons/react";

export function FetchFailed({
  onRetry,
  message = "取得できませんでした",
}: {
  onRetry: () => void;
  message?: string;
}) {
  return (
    <div className="fetch-failed">
      <span className="fetch-failed-label">
        <Warning size={16} weight="bold" aria-hidden="true" />
        {message}
      </span>
      <button type="button" className="btn-ink" onClick={onRetry}>
        再試行
      </button>
    </div>
  );
}
