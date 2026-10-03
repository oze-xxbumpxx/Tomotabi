export type LocalDate = string & { readonly __brand: "LocalDate" };

const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MILLIS_PER_DAY = 86_400_000;

function isRealDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  // Date.UTCは年0〜99を1900年代と解釈するため、実年を上書きしてから比べる
  date.setUTCFullYear(year);
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function toUtcMillis(value: LocalDate): number {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  date.setUTCFullYear(year!);
  return date.getTime();
}

export const LocalDate = {
  /**
   * `YYYY-MM-DD`の形式で実在する日付だけを受け付ける。
   * @throws形式が違う・実在しない日付のときErrorを投げる。
   */
  parse(value: string): LocalDate {
    const match = LOCAL_DATE_PATTERN.exec(value);
    if (match === null) {
      throw new Error("LocalDate must be YYYY-MM-DD");
    }
    const [, year, month, day] = match.map(Number);
    if (!isRealDate(year!, month!, day!)) {
      throw new Error("LocalDate must be a real calendar date");
    }
    return value as LocalDate;
  },

  /**
   * 前後関係を比べる。aが前なら負、同じなら0、後なら正を返す。
   */
  compare(a: LocalDate, b: LocalDate): number {
    return a < b ? -1 : a > b ? 1 : 0;
  },

  /**
   * aからbまでの日数（b - a）。bが前なら負を返す。
   */
  daysBetween(a: LocalDate, b: LocalDate): number {
    return Math.round((toUtcMillis(b) - toUtcMillis(a)) / MILLIS_PER_DAY);
  },
};
