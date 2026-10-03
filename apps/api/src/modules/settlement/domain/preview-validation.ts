import type { ClaimFingerprint } from "./fingerprint";
import type { ClaimKind } from "./settlement-target";

/**
 * 確認の明細1件が期待する、その支払いの状態（確認を作った時点の値）。
 * preview_itemsのkind・expected_claim_fingerprint・expected_cancelled
 * と対応する。
 */
export type PreviewItemExpectation = Readonly<{
  paymentId: string;
  kind: ClaimKind;
  expectedFingerprint: ClaimFingerprint | string;
  expectedCancelled: boolean;
}>;

/** 今の、その支払いの検証の材料（指紋と支払いの取り消し状態）。 */
export type CurrentClaimState = Readonly<{
  fingerprint: ClaimFingerprint | string;
  cancelled: boolean;
}>;

/** 確認にすでに紐づく精算（あれば検証結果は精算の有無・取り消しだけで決まる）。 */
export type ExistingSettlementState = Readonly<{
  id: string;
  cancelled: boolean;
}>;

export type PreviewValidationStatus =
  | "ready"
  | "cancelled_items_ack_required"
  | "target_changed"
  | "already_completed"
  | "completed_then_cancelled";

/**
 * 確認の、今の検証結果（F-23・詳細設計「確認内容の保持・再開」）。
 *
 * - 精算があれば、取り消し済みならcompleted_then_cancelled、有効なら
 *   already_completed（その確認はもう使えない。明細との比較はしない）。
 * - なければ明細ごとに、今の指紋と取り消し状態を確認の明細と比べる。
 *   指紋が違う対象があればtarget_changed（了承では戻せない）、
 *   そうでなくてBASE対象の支払いがあとで取り消されていれば
 *   cancelled_items_ack_required（了承つきで完了できる）、
 *   どちらも無ければready。
 * - 確認の後で増えた支払いは明細の指紋を変えないので、確認自体は
 *   readyのまま（新しい対象は残額の側に出る。F-21）。
 */
export type PreviewValidationOutcome = Readonly<{
  status: PreviewValidationStatus;
  /** 確認の後で取り消されたBASE対象の支払いID。 */
  cancelledPaymentIds: string[];
  /** 指紋が確認時点と違う対象の支払いID。 */
  changedPaymentIds: string[];
  existingSettlementId: string | null;
}>;

export function validatePreview(
  items: readonly PreviewItemExpectation[],
  current: ReadonlyMap<string, CurrentClaimState>,
  existingSettlement: ExistingSettlementState | null,
): PreviewValidationOutcome {
  if (existingSettlement !== null) {
    return {
      status: existingSettlement.cancelled
        ? "completed_then_cancelled"
        : "already_completed",
      cancelledPaymentIds: [],
      changedPaymentIds: [],
      existingSettlementId: existingSettlement.id,
    };
  }
  const cancelledPaymentIds: string[] = [];
  const changedPaymentIds: string[] = [];
  for (const item of items) {
    const state = current.get(item.paymentId);
    // 明細の支払いは消えないのでstateが無いことは無いが、あったら
    // 「対象が変わった」扱いに倒す（黙ってreadyにしない）。
    if (
      state === undefined ||
      state.fingerprint !== item.expectedFingerprint
    ) {
      changedPaymentIds.push(item.paymentId);
      continue;
    }
    if (
      item.kind === "BASE" &&
      !item.expectedCancelled &&
      state.cancelled
    ) {
      // 了承が要るのは「BASE対象があとで取り消された」場合だけ
      // （戻しの明細は取り消しを前提にしている）。次の精算の完了は
      // 「了承の集合が今の取り消し済みBASEの集合と一致」を見る。
      cancelledPaymentIds.push(item.paymentId);
    }
  }
  const status: PreviewValidationStatus =
    changedPaymentIds.length > 0
      ? "target_changed"
      : cancelledPaymentIds.length > 0
        ? "cancelled_items_ack_required"
        : "ready";
  return {
    status,
    cancelledPaymentIds,
    changedPaymentIds,
    existingSettlementId: null,
  };
}
