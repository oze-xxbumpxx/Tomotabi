import { Check, Circle, Clock } from "@phosphor-icons/react";
import type { TripStatus } from "@tomotabi/contracts";

export const TRIP_STATUS_LABEL: Record<TripStatus, string> = {
  planning: "出発前",
  traveling: "旅行中",
  finished: "終了",
};

/** 状態は色＋アイコン＋文字で出す（色だけに頼らない）。 */
export function TripStatusBadge({ status }: { status: TripStatus }) {
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
      {TRIP_STATUS_LABEL[status]}
    </span>
  );
}
