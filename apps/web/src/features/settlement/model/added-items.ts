import type {
  PreviewValidationStatus,
  TargetItem,
} from "../api/settlement-api";

/**
 * 確認を作ったあとに追加された支払いの件数（F-60）。
 * `ready`・`cancelled_items_ack_required`のときだけ数える
 * （この2つの状態では確認のあとに精算が1つも済んでいないので、
 * 残額の対象のうち確認の明細に無い支払いがそのまま追加分になる）。
 * ほかの状態では追加分と区別できないためnull。
 * REVERSAL（精算済みの支払いがあとで取り消されたときの戻し）は
 * 追加ではないので数えない。
 */
export function addedAfterPreviewCount(
  status: PreviewValidationStatus,
  previewItems: readonly TargetItem[],
  balanceItems: readonly TargetItem[],
): number | null {
  if (
    status !== "ready" &&
    status !== "cancelled_items_ack_required"
  ) {
    return null;
  }
  const itemIds = new Set(previewItems.map((item) => item.payment.id));
  return balanceItems.filter(
    (item) => item.kind === "BASE" && !itemIds.has(item.payment.id),
  ).length;
}
