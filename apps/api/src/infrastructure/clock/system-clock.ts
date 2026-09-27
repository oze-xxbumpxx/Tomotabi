import { Injectable } from "@nestjs/common";
import { LocalDate } from "../../common/domain/local-date";
import type { Clock } from "../../adapter/clock/clock";

const TOKYO_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function tokyoDate(instant: Date): LocalDate {
  const parts = TOKYO_FORMATTER.formatToParts(instant);
  const fields = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  ) as Record<"year" | "month" | "day", string>;
  return LocalDate.parse(`${fields.year}-${fields.month}-${fields.day}`);
}

@Injectable()
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }

  /**
   * Asia/Tokyo の今日。`this.now()` を経由するので、テストは `now()` を
   * 差し替えて UTC 15:00 の日付境界を確かめられる。
   */
  today(): LocalDate {
    return tokyoDate(this.now());
  }
}
