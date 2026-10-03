import { EyeSlash, ListBullets } from "@phosphor-icons/react";

/**
 * C-2開けない。403と404で文言を分けない（両方でこの部品を使う）。
 * 他の旅行の情報は出さない。
 */
export function NotAvailable({
  target,
  onGoToTrips,
  onGoToParent = null,
}: {
  target: "trip" | "item";
  onGoToTrips: () => void;
  /** 「しおりに戻る」のような近い場所への導線。項目（item）が開けないときに添える。 */
  onGoToParent?: { label: string; onClick: () => void } | null;
}) {
  return (
    <div className="state-screen">
      <EyeSlash
        size={44}
        className="state-screen-icon"
        aria-hidden="true"
      />
      <h1 className="state-screen-title">
        {target === "trip" ? "この旅行を開けません" : "この項目を開けません"}
      </h1>
      <p className="state-screen-body">
        削除されたか、開く権限がありません。
      </p>
      {onGoToParent !== null && (
        <button
          type="button"
          className="btn-ink"
          onClick={onGoToParent.onClick}
        >
          {onGoToParent.label}
        </button>
      )}
      <button
        type="button"
        className={onGoToParent === null ? "btn-ink" : "btn-secondary"}
        onClick={onGoToTrips}
      >
        <ListBullets size={16} weight="bold" aria-hidden="true" />
        旅行一覧へ
      </button>
    </div>
  );
}
