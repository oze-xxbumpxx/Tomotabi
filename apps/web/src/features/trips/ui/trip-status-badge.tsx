import { Check, Circle, Clock } from "@phosphor-icons/react";
import type { TripStatus } from "@tomotabi/contracts";

export const TRIP_STATUS_LABEL: Record<TripStatus, string> = {
  planning: "出発前",
  traveling: "旅行中",
  finished: "終了",
};

/**
 * 状態は色＋アイコン＋文字で出す（色だけに頼らない）。
 * 開始していない旅行は、今日が開始日以降なら「開始待ち」、
 * 開始日より前なら「出発前」。今日が分からないあいだは「出発前」。
 */
export function TripStatusBadge({
  status,
  startsOn,
  today,
}: {
  status: TripStatus;
  /** 旅行の開始日（`YYYY-MM-DD`）。 */
  startsOn: string;
  /** 日本時間の今日（`YYYY-MM-DD`）。分からないあいだはnull。 */
  today: string | null;
}) {
  const label =
    status === "planning" && today !== null && today >= startsOn
      ? "開始待ち"
      : TRIP_STATUS_LABEL[status];
  return (
    <span className={`trip-badge trip-badge-${status}`}>
      {status === "traveling" && (
        <Circle
          size={10}
          weight="fill"
          className="trip-badge-dot"
          aria-hidden="true"
        />
      )}
      {status === "planning" && (
        <Clock size={12} weight="bold" aria-hidden="true" />
      )}
      {status === "finished" && (
        <Check size={12} weight="bold" aria-hidden="true" />
      )}
      {label}
    </span>
  );
}
