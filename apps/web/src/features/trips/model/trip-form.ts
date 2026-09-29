import { boundedTextLength } from "@/shared/lib/text-length";
import { isLocalDateString } from "@/shared/lib/local-date";

/**
 * 旅行の作成・名前と期間の変更フォームで共通の検証。
 * 名前はコードポイントで 1〜100（API の BoundedText と同じ数え方）。
 * 日付は `YYYY-MM-DD` で実在する日で、開始 ≦ 終了。
 * エラーは欄ごとに持ち、最初のエラーの欄にフォーカスする（W-06）。
 */

export const TRIP_NAME_MAX_CODEPOINTS = 100;

export type TripFormField = "name" | "startsOn" | "endsOn";

export type TripFormValues = Record<TripFormField, string>;

export type TripFormErrors = Partial<Record<TripFormField, string>>;

export function validateTripForm(values: TripFormValues): TripFormErrors {
  const errors: TripFormErrors = {};

  const nameLength = boundedTextLength(values.name);
  if (nameLength === 0) {
    errors.name = "旅行名を入力してください";
  } else if (nameLength > TRIP_NAME_MAX_CODEPOINTS) {
    errors.name = "旅行名は 100 文字以内で入力してください";
  }

  if (values.startsOn === "") {
    errors.startsOn = "開始日を入力してください";
  } else if (!isLocalDateString(values.startsOn)) {
    errors.startsOn = "実在する日付を入力してください";
  }

  if (values.endsOn === "") {
    errors.endsOn = "終了日を入力してください";
  } else if (!isLocalDateString(values.endsOn)) {
    errors.endsOn = "実在する日付を入力してください";
  }

  if (
    errors.startsOn === undefined &&
    errors.endsOn === undefined &&
    values.startsOn > values.endsOn
  ) {
    errors.endsOn = "終了日は開始日以降の日付にしてください";
  }

  return errors;
}

/** フォームの欄の順（旅行名 → 開始日 → 終了日）で最初のエラー欄を返す。 */
export function firstInvalidField(
  errors: TripFormErrors,
): TripFormField | null {
  const order: TripFormField[] = ["name", "startsOn", "endsOn"];
  return order.find((field) => errors[field] !== undefined) ?? null;
}
