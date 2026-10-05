import {
  CalendarCheck,
  CheckCircle,
  Receipt,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";
import type { ListRecordsType } from "../api/records-api";

/**
 * 記録の一覧の絞り込み（「すべて・支払い・達成・予約」）。
 * 現在の絞り込みは濃い背景で出す。狭い画面では横に流して
 * 全部を一度に出さない（論点「絞り込みが幅に入りきらない」の答え）。
 */
export type RecordFilterKey = ListRecordsType | "all";

const FILTERS: { key: RecordFilterKey; label: string; icon: ReactNode }[] = [
  {
    key: "all",
    label: "すべて",
    icon: null,
  },
  {
    key: "payment",
    label: "支払い",
    icon: <Receipt size={16} aria-hidden="true" />,
  },
  {
    key: "achievement",
    label: "達成",
    icon: <CheckCircle size={16} weight="fill" aria-hidden="true" />,
  },
  {
    key: "booking",
    label: "予約",
    icon: <CalendarCheck size={16} weight="fill" aria-hidden="true" />,
  },
];

export function RecordFilters({
  current,
  onSelect,
}: {
  current: RecordFilterKey;
  onSelect: (key: RecordFilterKey) => void;
}) {
  return (
    <div className="record-filters" role="group" aria-label="記録の絞り込み">
      {FILTERS.map((filter) => (
        <button
          key={filter.key}
          type="button"
          className={`record-filter${
            filter.key === current ? " record-filter-current" : ""
          }`}
          aria-pressed={filter.key === current}
          onClick={() => onSelect(filter.key)}
        >
          {filter.icon}
          {filter.label}
        </button>
      ))}
    </div>
  );
}
