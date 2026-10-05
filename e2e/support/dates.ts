/**
 * 試験で使う日付を、実行日の日本時間の「今日」からの相対で作る。
 * ホームの表示の種類（出発前・期間中・期間が過ぎた）は日本時間の今日で
 * 決まる（F-41）ため、日付を決め打ちすると日が変わったあと試験が落ちる。
 */

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"] as const;

/** `YYYY-MM-DD`を年月日に分ける。形が違うときは試験のミスなので落とす。 */
function partsOf(isoDate: string): {
  year: number;
  month: number;
  day: number;
} {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (match === null) {
    throw new Error(`YYYY-MM-DD ではありません: ${isoDate}`);
  }
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

/** 日本時間（Asia/Tokyo）の今日を`YYYY-MM-DD`で返す。端末のタイムゾーンに依存しない。 */
function todayInTokyo(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** `YYYY-MM-DD`に`days`日を足す（月・年またぎはUTCでずらして日付だけを扱う）。 */
function addDays(isoDate: string, days: number): string {
  const { year, month, day } = partsOf(isoDate);
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10);
}

/**
 * 日本時間の今日から`offsetDays`日後を`YYYY-MM-DD`で返す。
 * 「出発前」で確かめる旅行は正の値（例: 今日+30日〜）で期間を作る。
 */
export function daysFromToday(offsetDays: number): string {
  return addDays(todayInTokyo(), offsetDays);
}

/**
 * `YYYY-MM-DD`を`11/7 土`の形にする。
 * 予定の日付の選択肢と同じ表示（アプリ側のformatLocalDateと同じ組み立て）。
 */
export function formatDayLabel(isoDate: string): string {
  const { month, day } = partsOf(isoDate);
  const weekday =
    WEEKDAYS[new Date(`${isoDate}T00:00:00.000Z`).getUTCDay()] ?? "";
  return `${month}/${day} ${weekday}`;
}
