import { createHash } from "node:crypto";
import type { ClaimKind } from "./settlement-target";

export type ClaimFingerprint = string & {
  readonly __brand: "ClaimFingerprint";
};

/**
 * 指紋の材料。その支払い1件の、精算まわりの今の状態と全履歴。
 * 支払いの取り消し状態はここに含めない（preview_itemsの別の列で比べる。
 * 詳細設計「支払いと精算」の「確認内容の保持・再開」）。
 */
export type ClaimHistory = Readonly<{
  /** 有効な占有。BASE・REVERSALそれぞれ0か1件で、値は精算のID。 */
  activeClaims: Readonly<Partial<Record<ClaimKind, string>>>;
  /**
   * この支払いを明細に含んだ精算の全履歴（取り消された精算の明細も含む）。
   * 並びは問わない（内側で決まった順に正規化する）。
   */
  items: ReadonlyArray<Readonly<{ settlementId: string; kind: ClaimKind }>>;
  /** この支払いを明細に含む精算のうち、取り消し済みのものの精算ID。 */
  cancelledSettlementIds: readonly string[];
}>;

/** 精算の履歴がまだ無い支払いの履歴（指紋の材料が空）。 */
export const EMPTY_CLAIM_HISTORY: ClaimHistory = {
  activeClaims: {},
  items: [],
  cancelledSettlementIds: [],
};

/**
 * その支払いの精算と取り消しの履歴をまとめた指紋（sha256の16進64桁）。
 * 有効なBASE・REVERSALの精算IDと、明細・精算取り消しの履歴IDを
 * 決まった順に並べて作る。精算と取り消しを経て占有が元に戻っても
 * 履歴が増えているので値は変わる（金額が同じでも「対象が変わった」と分かる。F-31）。
 */
export function fingerprintOf(history: ClaimHistory): ClaimFingerprint {
  const items = history.items
    .map((item) => `${item.settlementId}:${item.kind}`)
    .sort();
  const cancelled = [...history.cancelledSettlementIds].sort();
  const canonical = [
    "v1",
    `base=${history.activeClaims.BASE ?? "-"}`,
    `reversal=${history.activeClaims.REVERSAL ?? "-"}`,
    `items=${items.join(",")}`,
    `cancellations=${cancelled.join(",")}`,
  ].join("|");
  return createHash("sha256")
    .update(canonical, "utf8")
    .digest("hex") as ClaimFingerprint;
}
