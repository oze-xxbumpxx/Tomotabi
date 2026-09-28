import { EyeSlash, ListBullets } from "@phosphor-icons/react";

/**
 * C-2 開けない。403 と 404 で文言を分けない（両方でこの部品を使う）。
 * 他の旅行の情報は出さない。
 */
export function NotAvailable({
  target,
  onGoToTrips,
}: {
  target: "trip" | "item";
  onGoToTrips: () => void;
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
      <button type="button" className="btn-ink" onClick={onGoToTrips}>
        <ListBullets size={16} weight="bold" aria-hidden="true" />
        旅行一覧へ
      </button>
    </div>
  );
}
