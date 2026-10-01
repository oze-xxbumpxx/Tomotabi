import { SignedYen } from "../../../common/domain/yen";

/**
 * 精算の明細の種類。BASE は支払いをそのまま精算すること（寄与 c）、
 * REVERSAL は精算済みの支払いがあとで取り消されたときの戻し（−c）。
 */
export type ClaimKind = "BASE" | "REVERSAL";

/** 対象の導出に必要な、支払いの側の最小の情報。 */
export type PaymentForDerivation = Readonly<{
  id: string;
  contribution: SignedYen;
}>;

/**
 * 占有（settlement.active_claims）の 1 行。
 * 「どの支払いが、どの精算で済んでいるか」の今の状態。同じ支払いを
 * 二つの精算に入れないための補助状態で、履歴から作り直せる。
 */
export type ActiveClaim = Readonly<{
  paymentId: string;
  kind: ClaimKind;
  settlementId: string;
}>;

/** 次回の精算の対象 1 件。 */
export type SettlementTarget = Readonly<{
  paymentId: string;
  kind: ClaimKind;
  /** BASE はその支払いの寄与 c、REVERSAL は −c。 */
  contribution: SignedYen;
  /** REVERSAL のとき、戻す対象の BASE を済ませた精算の ID。BASE なら null。 */
  baseSettlementId: string | null;
}>;

export type InvalidClaimStateReason =
  | "REVERSAL_WITHOUT_BASE"
  | "REVERSAL_ON_ACTIVE_PAYMENT";

/**
 * 占有が正本の表に当てはまらない状態（戻しだけが有効、有効な支払いに戻しが
 * ある）。履歴と占有を同じトランザクションで保つ規則が破れているので、
 * 黙って導出せず検出する（F-13）。
 */
export class InvalidClaimStateError extends Error {
  constructor(
    readonly paymentId: string,
    readonly reason: InvalidClaimStateReason,
  ) {
    super(`invalid claim state for payment: ${reason}`);
    this.name = "InvalidClaimStateError";
  }
}

/**
 * 次回の精算の対象を導出する（F-11。詳細設計「支払いと精算」の
 * 「次回対象の導出」の表どおり）。
 *
 * | 支払い | 有効BASE | 有効REVERSAL | 対象 |
 * | 有効 | なし | なし | BASE、c |
 * | 有効 | あり | なし | なし |
 * | 取り消し済み | なし | なし | なし |
 * | 取り消し済み | あり | なし | REVERSAL、−c |
 * | 取り消し済み | あり | あり | なし |
 *
 * 返す対象の並びは payments の並びを保つ。
 * @throws InvalidClaimStateError
 */
export function deriveTargets(
  payments: readonly PaymentForDerivation[],
  cancelledPaymentIds: ReadonlySet<string>,
  activeClaims: readonly ActiveClaim[],
): SettlementTarget[] {
  const claimsByPayment = new Map<
    string,
    { BASE?: ActiveClaim; REVERSAL?: ActiveClaim }
  >();
  for (const claim of activeClaims) {
    const entry = claimsByPayment.get(claim.paymentId) ?? {};
    entry[claim.kind] = claim;
    claimsByPayment.set(claim.paymentId, entry);
  }
  const targets: SettlementTarget[] = [];
  for (const payment of payments) {
    const cancelled = cancelledPaymentIds.has(payment.id);
    const { BASE: base, REVERSAL: reversal } =
      claimsByPayment.get(payment.id) ?? {};
    if (reversal !== undefined) {
      if (base === undefined) {
        throw new InvalidClaimStateError(payment.id, "REVERSAL_WITHOUT_BASE");
      }
      if (!cancelled) {
        throw new InvalidClaimStateError(
          payment.id,
          "REVERSAL_ON_ACTIVE_PAYMENT",
        );
      }
      // 取り消し済み・BASE あり・REVERSAL あり → 対象なし
      continue;
    }
    if (!cancelled && base === undefined) {
      targets.push({
        paymentId: payment.id,
        kind: "BASE",
        contribution: payment.contribution,
        baseSettlementId: null,
      });
    } else if (cancelled && base !== undefined) {
      targets.push({
        paymentId: payment.id,
        kind: "REVERSAL",
        contribution: SignedYen.negate(payment.contribution),
        baseSettlementId: base.settlementId,
      });
    }
  }
  return targets;
}
