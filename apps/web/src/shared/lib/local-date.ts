const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `YYYY-MM-DD`の形で、かつ実在する日付ならtrue。 */
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

/** `YYYY-MM-DD`を`10/12 土`の形にする。呼び出し側で実在日を確かめてから使う。 */
export function formatLocalDate(value: string): string {
  const [, month, day] = value.split("-");
  return `${Number(month)}/${Number(day)} ${weekdayOf(value)}`;
}

/** 旅行の期間を`10/12 土 – 10/14 月`の形にする。1日だけなら1つだけ出す。 */
export function formatTripPeriod(startsOn: string, endsOn: string): string {
  const start = formatLocalDate(startsOn);
  return startsOn === endsOn ? start : `${start} – ${formatLocalDate(endsOn)}`;
}

/** 期間の日を`YYYY-MM-DD`の配列で返す（両端を含む）。異常な入力でも空で返す。 */
export function daysOfPeriod(startsOn: string, endsOn: string): string[] {
  if (!isLocalDateString(startsOn) || !isLocalDateString(endsOn)) {
    return [];
  }
  const days: string[] = [];
  const cursor = new Date(`${startsOn}T00:00:00.000Z`);
  const end = new Date(`${endsOn}T00:00:00.000Z`);
  // 期間の上限（1年超は入力ミスとみなして打ち切る）。
  while (cursor <= end && days.length < 366) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

/** 端末のローカル日付を`YYYY-MM-DD`で返す（「今日」の印用）。 */
export function todayLocalDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const tokyoDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const tokyoTimeFormatter = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  hour: "numeric",
  minute: "2-digit",
  hourCycle: "h23",
});

/** 日本時間（Asia/Tokyo）で`now`の日付を`YYYY-MM-DD`で返す。端末のタイムゾーンに依存しない。 */
export function tokyoDateOf(now: Date): string {
  const parts = tokyoDateFormatter.formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value ?? "";
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  const day = parts.find((part) => part.type === "day")?.value ?? "";
  return `${year}-${month}-${day}`;
}

/** 日本時間（Asia/Tokyo）で`now`の時刻を`H:mm`で返す。 */
export function tokyoTimeOf(now: Date): string {
  return tokyoTimeFormatter.format(now);
}

/** `YYYY-MM-DD`と日本の現地時刻`HH:mm`をUTCの瞬間にする。日本に夏時間はない。 */
export function tokyoInstantOf(date: string, time: string): Date {
  return new Date(`${date}T${time}:00+09:00`);
}

/** 残り時間（分）を`2 時間 19 分`の形にする。1時間未満は`45 分`、ちょうどは`2 時間`。 */
export function formatRemaining(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) {
    return `${minutes} 分`;
  }
  if (minutes === 0) {
    return `${hours} 時間`;
  }
  return `${hours} 時間 ${minutes} 分`;
}

/** ISO 8601の日時を`10/10 木 20:14`の形にする（記録日時の表示用）。 */
export function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  const weekday = WEEKDAYS[date.getDay()] ?? "";
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${date.getMonth() + 1}/${date.getDate()} ${weekday} ${hh}:${mm}`;
}
