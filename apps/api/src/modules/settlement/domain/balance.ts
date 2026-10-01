import type { ParticipantSlot } from "../../../common/domain/participant-slot";
import { SignedYen } from "../../../common/domain/yen";
import type { SettlementTarget } from "./settlement-target";

/**
 * 残額。誰から誰へいくら、と次回の対象の件数。
 * 対象 0 件と、対象があるが合計 0 円は targetCount で区別する（F-12）。
 */
export type Balance = Readonly<{
  /** 対象の寄与の合計。参加者番号 1 の人から 0 の人へ渡す向きを正とする。 */
  signedTotal: SignedYen;
  /** |signedTotal|。受け渡す金額。 */
  amount: SignedYen;
  /** 払う側の参加者番号。合計 0 円なら null。 */
  fromSlot: ParticipantSlot | null;
  /** 受け取る側の参加者番号。合計 0 円なら null。 */
  toSlot: ParticipantSlot | null;
  targetCount: number;
}>;

/**
 * 次回の対象から残額を組み立てる。
 * 合計が正なら参加者番号 1 の人が 0 の人へ払う（寄与の正の向き）。
 */
export function balanceOf(targets: readonly SettlementTarget[]): Balance {
  let signedTotal = SignedYen.ZERO;
  for (const target of targets) {
    signedTotal = SignedYen.add(signedTotal, target.contribution);
  }
  const amount = SignedYen.fromBigInt(
    signedTotal < 0n ? -signedTotal : signedTotal,
  );
  const fromSlot: ParticipantSlot | null =
    signedTotal > 0n ? 1 : signedTotal < 0n ? 0 : null;
  const toSlot: ParticipantSlot | null =
    signedTotal > 0n ? 0 : signedTotal < 0n ? 1 : null;
  return {
    signedTotal,
    amount,
    fromSlot,
    toSlot,
    targetCount: targets.length,
  };
}
