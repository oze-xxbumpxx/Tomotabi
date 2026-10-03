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

/** 受け渡しの向きと金額。残額と確認の応答で共通の導出。 */
export type TransferDirection = Readonly<{
  /** 対象の寄与の合計。参加者番号 1 の人から 0 の人へ渡す向きを正とする。 */
  signedTotal: SignedYen;
  /** |signedTotal|。受け渡す金額。 */
  amount: SignedYen;
  /** 払う側の参加者番号。合計 0 円なら null。 */
  fromSlot: ParticipantSlot | null;
  /** 受け取る側の参加者番号。合計 0 円なら null。 */
  toSlot: ParticipantSlot | null;
}>;

/**
 * 寄与の合計から受け渡しの向き・金額を決める。
 * 合計が正なら参加者番号 1 の人が 0 の人へ払う（寄与の正の向き）。
 */
export function transferOf(signedTotal: SignedYen): TransferDirection {
  const amount = SignedYen.fromBigInt(
    signedTotal < 0n ? -signedTotal : signedTotal,
  );
  return {
    signedTotal,
    amount,
    fromSlot: signedTotal > 0n ? 1 : signedTotal < 0n ? 0 : null,
    toSlot: signedTotal > 0n ? 0 : signedTotal < 0n ? 1 : null,
  };
}

/**
 * 次回の対象から残額を組み立てる。
 */
export function balanceOf(targets: readonly SettlementTarget[]): Balance {
  let signedTotal = SignedYen.ZERO;
  for (const target of targets) {
    signedTotal = SignedYen.add(signedTotal, target.contribution);
  }
  return {
    ...transferOf(signedTotal),
    targetCount: targets.length,
  };
}
