import type { Plan, PlanCreate, PlanPatch } from "@tomotabi/contracts";
import type { PlanKind } from "@tomotabi/contracts";
import { boundedTextLength } from "@/shared/lib/text-length";
import { isLocalDateString } from "@/shared/lib/local-date";

/**
 * 予定の追加・編集フォームで共通の検証と、編集時の diff（変更のあった
 * 項目だけを入れる PlanPatch）の組み立て。
 * 名前はコードポイントで 1〜100、日付は旅行期間内、時刻は `HH:mm` か
 * 「時刻未定」（null）、メモは 2000 文字まで（07 §6）。
 */

export const PLAN_NAME_MAX_CODEPOINTS = 100;
export const PLAN_MEMO_MAX_CODEPOINTS = 2000;

const TIME_PATTERN = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

export function isLocalTimeString(value: string): boolean {
  return TIME_PATTERN.test(value);
}

export type PlanFormField = "name" | "kind" | "date" | "time" | "memo";

export type PlanFormValues = {
  name: string;
  kind: PlanKind;
  /** `YYYY-MM-DD`。追加フォームだけで使う（編集は日の移動で変える）。 */
  date: string;
  /** 「時刻未定」なら true。true のあいだ time は送らない。 */
  timeUndecided: boolean;
  /** `HH:mm`。timeUndecided が false のときだけ意味を持つ。 */
  time: string;
  memo: string;
};

export type PlanFormErrors = Partial<Record<PlanFormField, string>>;

export function valuesOfPlan(plan: Plan): PlanFormValues {
  return {
    name: plan.name,
    kind: plan.kind,
    date: plan.date,
    timeUndecided: plan.time === null,
    time: plan.time ?? "",
    memo: plan.memo ?? "",
  };
}

export function validatePlanForm(
  values: PlanFormValues,
  period: { startsOn: string; endsOn: string } | null,
): PlanFormErrors {
  const errors: PlanFormErrors = {};

  const nameLength = boundedTextLength(values.name);
  if (nameLength === 0) {
    errors.name = "予定名を入力してください";
  } else if (nameLength > PLAN_NAME_MAX_CODEPOINTS) {
    errors.name = "予定名は 100 文字以内で入力してください";
  }

  if (values.date === "") {
    errors.date = "日付を選んでください";
  } else if (!isLocalDateString(values.date)) {
    errors.date = "実在する日付を選んでください";
  } else if (
    period !== null &&
    (values.date < period.startsOn || values.date > period.endsOn)
  ) {
    errors.date = "この日付は旅行期間の外です";
  }

  if (!values.timeUndecided) {
    if (values.time === "") {
      errors.time = "時刻を入力するか「時刻未定」にしてください";
    } else if (!isLocalTimeString(values.time)) {
      errors.time = "時刻を確認してください";
    }
  }

  if (boundedTextLength(values.memo) > PLAN_MEMO_MAX_CODEPOINTS) {
    errors.memo = "メモは 2000 文字以内で入力してください";
  }

  return errors;
}

/** フォームの欄の順（名前 → 種類 → 日付 → 時刻 → メモ）で最初のエラー欄を返す。 */
export function firstInvalidField(
  errors: PlanFormErrors,
): PlanFormField | null {
  const order: PlanFormField[] = ["name", "kind", "date", "time", "memo"];
  return order.find((field) => errors[field] !== undefined) ?? null;
}

function timeOf(values: PlanFormValues): string | null {
  return values.timeUndecided ? null : values.time;
}

function memoOf(values: PlanFormValues): string | null {
  const trimmed = values.memo.trim();
  return trimmed === "" ? null : trimmed;
}

/** 追加の body（時刻未定は `time: null` を明示して送る）。 */
export function planCreateOf(values: PlanFormValues): PlanCreate {
  return {
    name: values.name.trim(),
    kind: values.kind,
    date: values.date,
    time: timeOf(values),
    memo: memoOf(values),
  };
}

/** 編集の body。保存済みの値と違う項目だけを入れる（送っていない = 変えない）。 */
export function planPatchOf(plan: Plan, values: PlanFormValues): PlanPatch {
  const patch: PlanPatch = {};
  const name = values.name.trim();
  if (name !== plan.name) {
    patch.name = name;
  }
  if (values.kind !== plan.kind) {
    patch.kind = values.kind;
  }
  const time = timeOf(values);
  if (time !== plan.time) {
    patch.time = time;
  }
  const memo = memoOf(values);
  if (memo !== plan.memo) {
    patch.memo = memo;
  }
  return patch;
}
