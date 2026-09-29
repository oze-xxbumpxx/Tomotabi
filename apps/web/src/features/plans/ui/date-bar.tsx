"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  daysOfPeriod,
  formatLocalDate,
  todayLocalDate,
} from "@/shared/lib/local-date";

/**
 * しおりの日付バー（08）。期間の日を `N 日目` + 日付で並べ、選択は
 * `?date=` のリンクで再現する。長い旅行は横スクロールにし、
 * 選択中の日は見える位置までスクロールする。
 */
export function DateBar({
  tripId,
  startsOn,
  endsOn,
  selectedDate,
}: {
  tripId: string;
  startsOn: string;
  endsOn: string;
  /** 選択中の日（`YYYY-MM-DD`）。期間外の表示など、無いときは null。 */
  selectedDate: string | null;
}) {
  const days = daysOfPeriod(startsOn, endsOn);
  const selectedRef = useRef<HTMLAnchorElement>(null);
  // 「今日」の印は端末の日付に依存するため、描画の不一致を避けて effect で付ける。
  const [today, setToday] = useState<string | null>(null);

  useEffect(() => {
    setToday(todayLocalDate());
  }, []);

  useEffect(() => {
    const element = selectedRef.current;
    if (element !== null && typeof element.scrollIntoView === "function") {
      element.scrollIntoView({ block: "nearest", inline: "center" });
    }
  }, [selectedDate]);

  return (
    <nav className="date-bar" aria-label="日付を選ぶ">
      {days.map((day, index) => {
        const selected = day === selectedDate;
        return (
          <Link
            key={day}
            ref={selected ? selectedRef : null}
            href={`/trips/${tripId}/itinerary?date=${day}`}
            className={selected ? "date-cell date-cell-current" : "date-cell"}
            aria-current={selected ? "date" : undefined}
          >
            <span className="date-cell-num">
              {day === today ? `${index + 1} 日目 · 今日` : `${index + 1} 日目`}
            </span>
            <span className="date-cell-date tabular-nums">
              {formatLocalDate(day)}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
