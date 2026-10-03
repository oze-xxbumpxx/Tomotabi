import type { ParticipantSlot } from "../../../common/domain/participant-slot";
import { ApiError } from "../../../common/http/api-error";
import { BoundedText } from "../../../common/domain/bounded-text";
import { PaymentYen } from "../../../common/domain/yen";
import type { TripRosterEntry } from "../adapter/outbound/finance-work-context";
import type { CreatePaymentAllocation } from "../adapter/inbound/create-payment.input-port";

const MAX_LABEL_CODE_POINTS = 100;

function validationFailed(message: string): ApiError {
  return new ApiError({
    code: "VALIDATION_FAILED",
    status: 422,
    message,
  });
}

/**
 * 金額の値の規則（1〜9,999,999円）。形式は生成スキーマのパターンが
 * 先に見て400にする。ここでは値の規則として確かめる（ADR-0004）。
 * @throws範囲外は422 VALIDATION_FAILED。
 */
export function parseAmountYen(value: string): PaymentYen {
  try {
    return PaymentYen.parse(value);
  } catch {
    throw validationFailed("amountYen must be between 1 and 9999999");
  }
}

/**
 * 用途の値の規則（1〜100コードポイント・前後空白の除去。BoundedTextと同じ）。
 * 空白だけの用途は拒否（契約の記述どおり）。未指定はnull。
 * @throws空白だけ・上限超過は422 VALIDATION_FAILED。
 */
export function parsePaymentLabel(value: string | null): BoundedText | null {
  if (value === null) {
    return null;
  }
  try {
    return BoundedText.parse(value, MAX_LABEL_CODE_POINTS);
  } catch {
    throw validationFailed("label must be 1-100 characters");
  }
}

/**
 * 払った人の参加者番号をrosterから解決する。
 * @throws旅行の参加者でなければ422 VALIDATION_FAILED。
 */
export function payerSlotOf(
  roster: readonly TripRosterEntry[],
  payerUserId: string,
): ParticipantSlot {
  const entry = roster.find((candidate) => candidate.userId === payerUserId);
  if (entry === undefined) {
    throw validationFailed("payerUserId must be a trip participant");
  }
  return entry.slot;
}

/**
 * 分け方の値の規則（契約どおり）: 参加者二人を各1回指定し、
 * percentは0〜100の整数で合計100。参加者番号0の人の割合を返す
 * （保存はslot0_percentだけ。もう一人は100から引いた値）。
 * @throws範囲外・合計違い・参加者以外・重複・欠員は422 VALIDATION_FAILED。
 */
export function slot0PercentOf(
  roster: readonly TripRosterEntry[],
  allocations: readonly CreatePaymentAllocation[],
): number {
  const rosterUsers = new Set(roster.map((entry) => entry.userId as string));
  const byUser = new Map<string, number>();
  let total = 0;
  for (const allocation of allocations) {
    if (
      !Number.isInteger(allocation.percent) ||
      allocation.percent < 0 ||
      allocation.percent > 100
    ) {
      throw validationFailed("allocations percent must be an integer 0-100");
    }
    if (!rosterUsers.has(allocation.userId)) {
      throw validationFailed("allocations must name trip participants");
    }
    if (byUser.has(allocation.userId)) {
      throw validationFailed("allocations must name each participant once");
    }
    byUser.set(allocation.userId, allocation.percent);
    total += allocation.percent;
  }
  if (byUser.size !== rosterUsers.size) {
    throw validationFailed("allocations must name each participant once");
  }
  if (total !== 100) {
    throw validationFailed("allocations percent must add up to 100");
  }
  const slot0 = roster.find((entry) => entry.slot === 0);
  if (slot0 === undefined) {
    // 参加者番号0のいない旅行は作れない。通常は到達しない。
    throw validationFailed("trip has no slot-0 participant");
  }
  return byUser.get(slot0.userId) ?? 0;
}
