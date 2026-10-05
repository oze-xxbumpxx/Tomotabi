import { boundedTextLength } from "@/shared/lib/text-length";
import { isLocalDateString } from "@/shared/lib/local-date";

/**
 * 旅行の作成・名前と期間の変更フォームで共通の検証。
 * 名前はコードポイントで1〜100（APIのBoundedTextと同じ数え方）。
 * 日付は`YYYY-MM-DD`で実在する日で、開始 ≦ 終了。
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

/**
 * 端末に残した要求の本文（`{name, startsOn, endsOn}`）から、固定表示する
 * フォームの値を戻す。形が確かめられないものはnull（確認の操作だけを出す）。
 */
export function tripFormValuesFromJson(
  bodyJson: string,
): TripFormValues | null {
  let body: unknown;
  try {
    body = JSON.parse(bodyJson);
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const candidate = body as Record<string, unknown>;
  if (
    typeof candidate.name !== "string" ||
    typeof candidate.startsOn !== "string" ||
    typeof candidate.endsOn !== "string"
  ) {
    return null;
  }
  return {
    name: candidate.name,
    startsOn: candidate.startsOn,
    endsOn: candidate.endsOn,
  };
}
