import { ApiError } from "../../../common/http/api-error";
import { BoundedText } from "../../../common/domain/bounded-text";
import { LocalDate } from "../../../common/domain/local-date";
import { TripPeriod } from "../domain/trip-period";

const MAX_NAME_CODE_POINTS = 100;

/**
 * 名前の値の規則（コードポイントの文字数・前後空白）。生成スキーマは形式だけを
 * 見るため、上限を含めて Domain の値型が検証する（ADR-0004）。
 * @throws 空・100 コードポイント超は 422 VALIDATION_FAILED。
 */
export function parseTripName(value: string): BoundedText {
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
 * 期間の値の規則（YYYY-MM-DD・実在日・開始 ≦ 終了）。
 * @throws 形式はあるが値が不正なとき 422 VALIDATION_FAILED。
 */
export function parseTripPeriod(startsOn: string, endsOn: string): TripPeriod {
  try {
    return TripPeriod.create(LocalDate.parse(startsOn), LocalDate.parse(endsOn));
  } catch {
    throw new ApiError({
      code: "VALIDATION_FAILED",
      status: 422,
      message: "startsOn and endsOn must be real dates with startsOn on or before endsOn",
    });
  }
}
