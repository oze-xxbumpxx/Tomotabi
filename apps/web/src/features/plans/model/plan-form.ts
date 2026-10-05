import type { Plan, PlanCreate, PlanPatch } from "@tomotabi/contracts";
import type { PlanKind } from "@tomotabi/contracts";
import { boundedTextLength } from "@/shared/lib/text-length";
import { isLocalDateString } from "@/shared/lib/local-date";
import { PLAN_KINDS } from "./plan-kind";

/**
 * 予定の追加・編集フォームで共通の検証と、編集時のdiff（変更のあった
 * 項目だけを入れるPlanPatch）の組み立て。
 * 名前はコードポイントで1〜100、日付は旅行期間内、時刻は`HH:mm`か
 * 「時刻未定」（null）、メモは2000文字まで（07 §6）。
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
  /** 追加では未選択（null）から始めて必須にする（07 §6）。 */
  kind: PlanKind | null;
  /** `YYYY-MM-DD`。追加フォームだけで使う（編集は日の移動で変える）。 */
  date: string;
  /** 「時刻未定」ならtrue。trueのあいだtimeは送らない。 */
  timeUndecided: boolean;
  /** `HH:mm`。timeUndecidedがfalseのときだけ意味を持つ。 */
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

  if (values.kind === null) {
    errors.kind = "種類を選んでください";
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

/** 追加のbody（時刻未定は`time: null`を明示して送る）。検証済みの値にだけ使う。 */
export function planCreateOf(
  values: PlanFormValues & { kind: PlanKind },
): PlanCreate {
  return {
    name: values.name.trim(),
    kind: values.kind,
    date: values.date,
    time: timeOf(values),
    memo: memoOf(values),
  };
}

/**
 * 編集のbody。基準の欄（フォームを開いたとき、または競合で
 * 「最新の内容で入力し直す」を選んだあとの欄）と違う項目だけを入れる
 * （送っていない = 変えない）。
 */
export function planPatchOf(
  base: PlanFormValues,
  values: PlanFormValues,
): PlanPatch {
  const patch: PlanPatch = {};
  const name = values.name.trim();
  if (name !== base.name.trim()) {
    patch.name = name;
  }
  if (values.kind !== null && values.kind !== base.kind) {
    patch.kind = values.kind;
  }
  const time = timeOf(values);
  if (time !== timeOf(base)) {
    patch.time = time;
  }
  const memo = memoOf(values);
  if (memo !== memoOf(base)) {
    patch.memo = memo;
  }
  return patch;
}

/**
 * 端末に残した要求の本文（PlanCreate）から、固定表示するフォームの値を戻す。
 * 形が確かめられないものはnull（確認の操作だけを出す）。
 */
export function planFormValuesFromJson(
  bodyJson: string,
): PlanFormValues | null {
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
    typeof candidate.kind !== "string" ||
    !(PLAN_KINDS as readonly string[]).includes(candidate.kind) ||
    typeof candidate.date !== "string" ||
    (candidate.time !== null &&
      candidate.time !== undefined &&
      typeof candidate.time !== "string") ||
    (candidate.memo !== null &&
      candidate.memo !== undefined &&
      typeof candidate.memo !== "string")
  ) {
    return null;
  }
  return {
    name: candidate.name,
    kind: candidate.kind as PlanKind,
    date: candidate.date,
    timeUndecided: candidate.time === null || candidate.time === undefined,
    time: typeof candidate.time === "string" ? candidate.time : "",
    memo: typeof candidate.memo === "string" ? candidate.memo : "",
  };
}
