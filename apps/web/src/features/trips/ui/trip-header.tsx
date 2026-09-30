"use client";

import { DotsThree } from "@phosphor-icons/react";
import type { Trip } from "@tomotabi/contracts";
import { formatTripPeriod } from "@/shared/lib/local-date";
import { TripStatusBadge } from "./trip-status-badge";

/** 旅行ヘッダー（16）：旅行名・期間・状態バッジ、「…」でメニューを開く。 */
export function TripHeader({
  trip,
  onOpenMenu,
}: {
  trip: Trip;
  onOpenMenu: () => void;
}) {
  return (
    <header className="trip-header">
      <div className="trip-header-main">
        <span className="trip-header-period tabular-nums">
          {trip.status === "finished"
            ? `終了 · ${formatTripPeriod(trip.startsOn, trip.endsOn)}`
            : formatTripPeriod(trip.startsOn, trip.endsOn)}
        </span>
        <h1 className="trip-header-name">{trip.name}</h1>
      </div>
      <TripStatusBadge status={trip.status} />
      <button
        type="button"
        className="icon-button"
        onClick={onOpenMenu}
        aria-label="旅行のメニュー"
      >
        <DotsThree size={20} weight="bold" aria-hidden="true" />
      </button>
    </header>
  );
}
