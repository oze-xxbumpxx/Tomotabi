import { boundedTextLength } from "@/shared/lib/text-length";
import { isPaymentYenAmount, yenToDecimalString } from "@/shared/lib/yen";
import type {
  Participant,
  PaymentCreate,
} from "../api/payments-api";

/**
 * 支払いを記録のフォームの検証と、送る割合（参加者番号 0 の人の負担の
 * 割合）の組み立て、二人の負担の画面計算。金額は BigInt の円で持ち、
 * Number・parseInt に通さない。
 */

export const PAYMENT_LABEL_MAX_CODEPOINTS = 100;
export const PAYMENT_PERCENT_MAX = 100;

export type PaymentSplitMode = "half" | "payer-all" | "other-all" | "ratio";

/** 関連する予定（選んだ予定の表示に要る項目だけを持つ）。 */
export type SelectedPlan = { id: string; date: string; name: string };

export type PaymentFormValues = {
  /** 画面の入力そのまま（正規化は検証時）。 */
  amount: string;
  payerUserId: string | null;
  mode: PaymentSplitMode;
  /** 「割合を指定」の自分の負担 % の入力そのまま。 */
  myPercent: string;
  label: string;
  plan: SelectedPlan | null;
};

export type PaymentFormField = "amount" | "myPercent" | "label";
export type PaymentFormErrors = Partial<Record<PaymentFormField, string>>;

const FULLWIDTH_ZERO = 0xff10;
const FULLWIDTH_NINE = 0xff19;

/**
 * 全角数字を半角に直し、前後の空白を除く。カンマ・円記号・小数点などは
 * 黙って除かずそのまま残す（07 §6「黙って数値変換せず理由を示す」）。
 */
function digitsOfInput(raw: string): string {
  let out = "";
  for (const ch of raw.trim()) {
    const code = ch.codePointAt(0);
    if (
      code !== undefined &&
      code >= FULLWIDTH_ZERO &&
      code <= FULLWIDTH_NINE
    ) {
      out += String.fromCharCode(code - FULLWIDTH_ZERO + 0x30);
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * 金額欄の入力を円にする。全角数字は半角へ直すが、カンマ・小数・符号・
 * 数字以外が混ざる入力は null を返す（"7,001" はエラーになる）。
 */
export function paymentAmountFromInput(raw: string): bigint | null {
  const digits = digitsOfInput(raw);
  if (!/^[0-9]+$/.test(digits)) {
    return null;
  }
  return BigInt(digits);
}

/** 「自分の負担」% の入力。0〜100 の整数だけを受け、それ以外は null。 */
export function percentFromInput(raw: string): number | null {
  const digits = digitsOfInput(raw);
  if (!/^[0-9]+$/.test(digits)) {
    return null;
  }
  const value = Number(digits);
  if (!Number.isInteger(value) || value < 0 || value > PAYMENT_PERCENT_MAX) {
    return null;
  }
  return value;
}

/**
 * 分け方から送る割合（参加者番号 0 の人の負担の割合。F-03）を作る。
 * 払った人を切り替えても正しく作る: 割合指定は各人の割合を維持し、
 * 全額モードは新しい支払者を基準に再計算する（07 §6）。
 * `myPercent` は mode が ratio のときだけ意味を持つ（検証済みの値を渡す）。
 */
export function slot0PercentOf(
  mode: PaymentSplitMode,
  payer: Participant,
  me: Participant,
  myPercent: number,
): number {
  switch (mode) {
    case "half":
      return 50;
    case "payer-all":
      return payer.slot === 0 ? 100 : 0;
    case "other-all":
      return payer.slot === 0 ? 0 : 100;
    case "ratio":
      return me.slot === 0 ? myPercent : PAYMENT_PERCENT_MAX - myPercent;
  }
}

/**
 * サーバーと同じ式で二人の負担を計算する（F-04: 払った人でない人 =
 * floor(金額 × その人の割合 ÷ 100)、払った人 = 金額 − もう一人）。
 * 画面の確認用。保存される負担はサーバーが計算する。
 */
export function burdensOf(
  amountYen: bigint,
  slot0Percent: number,
  payer: Participant,
): { slot0: bigint; slot1: bigint } {
  if (payer.slot === 0) {
    const slot1 = (amountYen * BigInt(PAYMENT_PERCENT_MAX - slot0Percent)) / 100n;
    return { slot0: amountYen - slot1, slot1 };
  }
  const slot0 = (amountYen * BigInt(slot0Percent)) / 100n;
  return { slot0, slot1: amountYen - slot0 };
}

export function validatePaymentForm(
  values: PaymentFormValues,
): PaymentFormErrors {
  const errors: PaymentFormErrors = {};

  const digits = digitsOfInput(values.amount);
  if (digits === "") {
    errors.amount = "金額を入力してください";
  } else if (!/^[0-9]+$/.test(digits)) {
    errors.amount = "半角数字だけで入力してください";
  } else if (!isPaymentYenAmount(BigInt(digits))) {
    errors.amount = "1 円から 9,999,999 円までの金額にしてください";
  }

  if (
    values.mode === "ratio" &&
    percentFromInput(values.myPercent) === null
  ) {
    errors.myPercent = "0 から 100 の整数で入力してください";
  }

  if (boundedTextLength(values.label) > PAYMENT_LABEL_MAX_CODEPOINTS) {
    errors.label = "用途は 100 文字以内で入力してください";
  }

  return errors;
}

/** フォームの欄の順（金額 → 割合 → 用途）で最初のエラー欄を返す。 */
export function firstInvalidField(
  errors: PaymentFormErrors,
): PaymentFormField | null {
  const order: PaymentFormField[] = ["amount", "myPercent", "label"];
  return order.find((field) => errors[field] !== undefined) ?? null;
}

/**
 * 検証済みのフォーム値から POST /payments の body を組み立てる。
 * allocations は参加者番号 0, 1 の順で、割合の合計は 100。
 * label・planId は契約上 optional で null を受けないため、
 * 無いときはプロパティごと送らない。
 */
export function paymentCreateOf(
  values: PaymentFormValues,
  payer: Participant,
  me: Participant,
  participants: readonly Participant[],
): PaymentCreate | null {
  const amount = paymentAmountFromInput(values.amount);
  if (amount === null || !isPaymentYenAmount(amount)) {
    return null;
  }
  const myPercent = percentFromInput(values.myPercent);
  if (values.mode === "ratio" && myPercent === null) {
    return null;
  }
  const slot0 = participants.find((p) => p.slot === 0);
  const slot1 = participants.find((p) => p.slot === 1);
  if (slot0 === undefined || slot1 === undefined) {
    return null;
  }
  const slot0Percent = slot0PercentOf(
    values.mode,
    payer,
    me,
    myPercent ?? 0,
  );
  const label = values.label.trim();
  return {
    amountYen: yenToDecimalString(amount),
    payerUserId: payer.userId,
    allocations: [
      { userId: slot0.userId, percent: slot0Percent },
      { userId: slot1.userId, percent: PAYMENT_PERCENT_MAX - slot0Percent },
    ],
    ...(label !== "" ? { label } : {}),
    ...(values.plan !== null ? { planId: values.plan.id } : {}),
  };
}

/** 分け方に添える注記（v3 の shareNote）。 */
export function shareNoteOf(mode: PaymentSplitMode): string | null {
  switch (mode) {
    case "half":
      return "割り切れない 1 円は払った人の負担になります";
    case "ratio":
      return "払っていない人の負担は円未満切り捨て";
    default:
      return null;
  }
}

/** 3 桁区切りの数字だけ（"2,400"。「円」は欄の外に出す）。 */
export function groupedYenDigits(yen: bigint): string {
  const digits = yen.toString();
  let out = "";
  for (let i = 0; i < digits.length; i += 1) {
    const rest = digits.length - i;
    out += digits[i];
    if (rest > 1 && rest % 3 === 1) {
      out += ",";
    }
  }
  return out;
}

/** 保留中の要求の本文（PaymentCreate の形。record.bodyJson を parse したもの）。 */
export type PendingPaymentBody = {
  amountYen: string;
  payerUserId: string;
  allocations: { userId: string; percent: number }[];
  label?: string;
  planId?: string;
};

/**
 * 保留中の要求の bodyJson を PaymentCreate の形に戻す。
 * 形が確かめられないものは null（その要求は送り直さない）。
 */
export function paymentBodyFromJson(
  bodyJson: string,
): PendingPaymentBody | null {
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
  const allocations = candidate.allocations;
  if (
    typeof candidate.amountYen !== "string" ||
    typeof candidate.payerUserId !== "string" ||
    !Array.isArray(allocations) ||
    allocations.length !== 2 ||
    !allocations.every(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as { userId?: unknown }).userId === "string" &&
        typeof (item as { percent?: unknown }).percent === "number",
    )
  ) {
    return null;
  }
  return candidate as PendingPaymentBody;
}

/**
 * 保留中の要求の本文から、固定表示するフォーム値を作る。
 * 分け方の選択は本文に残らないため割合から逆算する
 * （50 は折半、全額に一致するときは全額、それ以外は割合を指定）。
 */
export function valuesOfPendingBody(
  body: PendingPaymentBody,
  me: Participant,
  participants: readonly Participant[],
  plan: SelectedPlan | null,
): PaymentFormValues | null {
  const payer = participants.find((p) => p.userId === body.payerUserId);
  const slot0 = participants.find((p) => p.slot === 0);
  if (payer === undefined || slot0 === undefined) {
    return null;
  }
  const slot0Alloc = body.allocations.find((a) => a.userId === slot0.userId);
  const amount = paymentAmountFromInput(body.amountYen);
  if (slot0Alloc === undefined || amount === null) {
    return null;
  }
  const percent = slot0Alloc.percent;
  let mode: PaymentSplitMode;
  if (percent === 50) {
    mode = "half";
  } else if (percent === (payer.slot === 0 ? 100 : 0)) {
    mode = "payer-all";
  } else if (percent === (payer.slot === 0 ? 0 : 100)) {
    mode = "other-all";
  } else {
    mode = "ratio";
  }
  const myPercent = me.slot === 0 ? percent : PAYMENT_PERCENT_MAX - percent;
  return {
    amount: groupedYenDigits(amount),
    payerUserId: payer.userId,
    mode,
    myPercent: String(myPercent),
    label: body.label ?? "",
    plan,
  };
}
