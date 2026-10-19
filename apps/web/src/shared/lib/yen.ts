/**
 * 円の扱い。金額は常にBigIntの円で持ち、Numberに通さない
 * （合計や符号付きの計算で丸めを持ち込まないため）。
 * APIとの受け渡しは10進の整数文字列（"7001"、符号付きは"-3500"）。
 */

/** 支払い1件の上限（要件定義の境界条件。正本の999,999,999円から下げた値）。 */
export const PAYMENT_YEN_MAX = 9_999_999n;
export const PAYMENT_YEN_MIN = 1n;

const FULLWIDTH_ZERO = 0xff10;
const FULLWIDTH_NINE = 0xff19;

/** 全角数字を半角に直し、カンマ（半角・全角）を除く。 */
function normalizeDigits(raw: string): string {
  let out = "";
  for (const ch of raw.trim()) {
    const code = ch.codePointAt(0);
    if (code === undefined) {
      continue;
    }
    if (code >= FULLWIDTH_ZERO && code <= FULLWIDTH_NINE) {
      out += String.fromCharCode(code - FULLWIDTH_ZERO + 0x30);
    } else if (ch === "," || ch === "，") {
      continue;
    } else {
      out += ch;
    }
  }
  return out;
}

/** 10進の整数文字列だけをBigIntにする。形式が違えばnull。符号も受ける。 */
function parseDecimal(text: string): bigint | null {
  if (!/^-?\d+$/.test(text)) {
    return null;
  }
  return BigInt(text);
}

/**
 * 契約の10進整数文字列（"7001"、符号付きは"-3500"）をBigIntにする。
 * 形式違い（カンマ・小数・空白・数字以外）はnull。
 */
export function yenFromDecimalString(value: string): bigint | null {
  return parseDecimal(value);
}

/**
 * 画面の入力を円にする。全角数字とカンマ区切りを受け、前後の空白
 * （全角スペースを含む）を除く。正の整数だけを受け、空・小数・
 * 符号・数字以外が混ざる入力はnull。
 */
export function yenFromInput(raw: string): bigint | null {
  const normalized = normalizeDigits(raw);
  if (!/^\d+$/.test(normalized)) {
    return null;
  }
  return BigInt(normalized);
}

/** BigIntの円を契約の10進整数文字列にする（"7001"・"-3500"）。 */
export function yenToDecimalString(yen: bigint): string {
  return yen.toString();
}

/** 3桁区切りの数字だけ（"7,001"・負は"-3,500"）。「円」を別扱いにする欄で使う。 */
export function formatYenDigits(yen: bigint): string {
  const negative = yen < 0n;
  const digits = (negative ? -yen : yen).toString();
  let grouped = "";
  for (let i = 0; i < digits.length; i += 1) {
    const rest = digits.length - i;
    grouped += digits[i];
    if (rest > 1 && rest % 3 === 1) {
      grouped += ",";
    }
  }
  return `${negative ? "-" : ""}${grouped}`;
}

/** 3桁区切りの表示（"7,001円"・負は"-3,500円"）。 */
export function formatYen(yen: bigint): string {
  return `${formatYenDigits(yen)} 円`;
}

/** 支払い1件として受け付ける範囲（1〜9,999,999円）か。 */
export function isPaymentYenAmount(yen: bigint): boolean {
  return yen >= PAYMENT_YEN_MIN && yen <= PAYMENT_YEN_MAX;
}

/**
 * 金額の入力欄を、打ったそばから3桁区切りにする（スマホの数字のキーボードにはカンマが無いため）。
 * 数字（全角を含む）とカンマだけのときだけ整え、ほかの文字が混ざれば触らない
 * （欄の検証で誤りを出すため）。`caret`は入力位置で、整えたあとの位置を返す。
 */
export function groupYenInput(
  raw: string,
  caret: number,
): { value: string; caret: number } {
  // 前後の空白（全角を含む）は、検証と同じく除いてから見る（貼り付けた金額のため）。
  const trimmed = raw.trim();
  if (!/^[0-9０-９,，]*$/.test(trimmed)) {
    return { value: raw, caret };
  }
  const isDigit = (ch: string): boolean => /[0-9０-９]/.test(ch);
  const digitsBefore = [...raw.slice(0, caret)].filter(isDigit).length;
  const digits = normalizeDigits(trimmed);
  let value = "";
  for (let i = 0; i < digits.length; i += 1) {
    const rest = digits.length - i;
    value += digits[i];
    if (rest > 1 && rest % 3 === 1) {
      value += ",";
    }
  }
  let seen = 0;
  let next = 0;
  while (next < value.length && seen < digitsBefore) {
    if (value[next] !== ",") {
      seen += 1;
    }
    next += 1;
  }
  return { value, caret: next };
}
