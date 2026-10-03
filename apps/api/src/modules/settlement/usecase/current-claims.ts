import {
  EMPTY_CLAIM_HISTORY,
  fingerprintOf,
  type ClaimHistory,
} from "../domain/fingerprint";
import type { CurrentClaimState } from "../domain/preview-validation";

/**
 * 確認の明細の支払いそれぞれについて、今の検証の材料（指紋と取り消し
 * 状態）を組み立てる。履歴の無い支払いは空の履歴の指紋（初回は
 * 確認の明細と一致するはず）。
 */
export function currentClaimStates(
  paymentIds: readonly string[],
  histories: ReadonlyMap<string, ClaimHistory>,
  cancelledPaymentIds: ReadonlySet<string>,
): Map<string, CurrentClaimState> {
  const states = new Map<string, CurrentClaimState>();
  for (const paymentId of paymentIds) {
    states.set(paymentId, {
      fingerprint: fingerprintOf(
        histories.get(paymentId) ?? EMPTY_CLAIM_HISTORY,
      ),
      cancelled: cancelledPaymentIds.has(paymentId),
    });
  }
  return states;
}
