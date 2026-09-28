const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `YYYY-MM-DD` の形で、かつ実在する日付なら true。 */
export function isLocalDateString(value: string): boolean {
  const match = DATE_PATTERN.exec(value);
  if (match === null) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"] as const;

function weekdayOf(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return weekday ?? "";
}

/** `YYYY-MM-DD` を `10/12 土` の形にする。呼び出し側で実在日を確かめてから使う。 */
export function formatLocalDate(value: string): string {
  const [, month, day] = value.split("-");
  return `${Number(month)}/${Number(day)} ${weekdayOf(value)}`;
}

/** 旅行の期間を `10/12 土 – 10/14 月` の形にする。1 日だけなら 1 つだけ出す。 */
export function formatTripPeriod(startsOn: string, endsOn: string): string {
  const start = formatLocalDate(startsOn);
  return startsOn === endsOn ? start : `${start} – ${formatLocalDate(endsOn)}`;
}
