"use client";

import {
  daysOfPeriod,
  formatLocalDate,
} from "@/shared/lib/local-date";

/**
 * 期間の日を 3 等分の格子で選ぶ選択部品（11c）。予定の追加の日付と
 * 日の移動で使う。選択はリンクではなく `onSelect` で返す（form / sheet の値）。
 */
export function DatePickerGrid({
  startsOn,
  endsOn,
  value,
  disabled = false,
  onSelect,
}: {
  startsOn: string;
  endsOn: string;
  /** 選択中の日（`YYYY-MM-DD`）。 */
  value: string | null;
  disabled?: boolean;
  onSelect: (date: string) => void;
}) {
  const days = daysOfPeriod(startsOn, endsOn);
  return (
    <div className="date-picker" role="radiogroup">
      {days.map((day) => {
        const selected = day === value;
        return (
          <button
            key={day}
            type="button"
            role="radio"
            aria-checked={selected}
            className={
              selected ? "date-picker-cell date-picker-cell-current" : "date-picker-cell"
            }
            disabled={disabled}
            onClick={() => onSelect(day)}
          >
            {formatLocalDate(day)}
          </button>
        );
      })}
    </div>
  );
}
