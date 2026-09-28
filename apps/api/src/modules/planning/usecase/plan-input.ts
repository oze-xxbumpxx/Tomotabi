import { ApiError } from "../../../common/http/api-error";
import { BoundedText } from "../../../common/domain/bounded-text";
import { LocalDate } from "../../../common/domain/local-date";
import { LocalTime } from "../../../common/domain/local-time";
import { PlanKind } from "../domain/plan-kind";

const MAX_NAME_CODE_POINTS = 100;
const MAX_MEMO_CODE_POINTS = 2000;

/**
 * 名前の値の規則（1〜100 コードポイント・前後空白の除去）。
 * @throws 空・上限超過は 422 VALIDATION_FAILED。
 */
export function parsePlanName(value: string): BoundedText {
  try {
    return BoundedText.parse(value, MAX_NAME_CODE_POINTS);
  } catch {
    throw new ApiError({
      code: "VALIDATION_FAILED",
      status: 422,
      message: "name must be 1-100 characters",
    });
  }
}

/**
 * メモの値の規則（2000 コードポイントまで）。未指定・空白だけは null。
 * @throws 上限超過は 422 VALIDATION_FAILED。
 */
export function parsePlanMemo(value: string | null): BoundedText | null {
  try {
    return BoundedText.parseOptional(value, MAX_MEMO_CODE_POINTS);
  } catch {
    throw new ApiError({
      code: "VALIDATION_FAILED",
      status: 422,
      message: "memo must be at most 2000 characters",
    });
  }
}

/**
 * 種類の値の規則。生成スキーマの enum が先に見るが、値の規則として
 * ここでも確かめる（ADR-0004）。
 * @throws 5 種類以外は 422 VALIDATION_FAILED。
 */
export function parsePlanKind(value: string): PlanKind {
  try {
    return PlanKind.parse(value);
  } catch {
    throw new ApiError({
      code: "VALIDATION_FAILED",
      status: 422,
      message: "kind must be one of place/food/shopping/lodging/transport",
    });
  }
}

/**
 * 日付の値の規則（YYYY-MM-DD・実在日）。
 * @throws 実在しない日付は 422 VALIDATION_FAILED。
 */
export function parsePlanDate(value: string): LocalDate {
  try {
    return LocalDate.parse(value);
  } catch {
    throw new ApiError({
      code: "VALIDATION_FAILED",
      status: 422,
      message: "date must be a real calendar date",
    });
  }
}

/**
 * 時刻の値の規則（HH:mm・秒なし）。null はそのまま（時刻未定）。
 * @throws `HH:mm` でないとき 422 VALIDATION_FAILED。
 */
export function parsePlanTime(value: string | null): LocalTime | null {
  if (value === null) {
    return null;
  }
  try {
    return LocalTime.parse(value);
  } catch {
    throw new ApiError({
      code: "VALIDATION_FAILED",
      status: 422,
      message: "time must be HH:mm",
    });
  }
}
