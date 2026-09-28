import { WifiSlash } from "@phosphor-icons/react";

/**
 * C-3 オフライン。`at` は「表示中の内容」の取得時刻（無いときは時刻の文を省略する）。
 * 保存につながるボタンは `useOnlineStatus` が false のあいだ `disabled` にし、
 * 押せない理由を隣に出す。
 */
export function OfflineBanner({ at }: { at: Date | null }) {
  return (
    <div className="banner banner-warning offline-banner" role="alert">
      <WifiSlash size={18} weight="bold" className="banner-icon" aria-hidden="true" />
      <div className="banner-text">
        <span className="banner-title">インターネットに接続できません</span>
        <span className="banner-body">
          {at !== null
            ? `表示は ${formatTime(at)} 時点の内容です。`
            : "表示中の内容はそのままです。"}
          保存はできません。
        </span>
      </div>
    </div>
  );
}

function formatTime(date: Date): string {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}
