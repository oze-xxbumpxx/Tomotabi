"use client";

import { Check } from "@phosphor-icons/react";
import Link from "next/link";
import type { Trip } from "@tomotabi/contracts";
import { formatTripPeriod } from "@/shared/lib/local-date";
import { TripStatusBadge } from "./trip-status-badge";

/** 一覧の1行（15）。押すとその旅行のしおりへ移る。 */
export function TripRow({
  trip,
  selected,
}: {
  trip: Trip;
  selected: boolean;
}) {
  return (
    <Link
      href={`/trips/${trip.id}/itinerary`}
      className="trip-row"
    >
      <span className="trip-row-main">
        <span className="trip-row-name">{trip.name}</span>
        <span className="trip-row-date tabular-nums">
          {formatTripPeriod(trip.startsOn, trip.endsOn)}
        </span>
      </span>
      <TripStatusBadge status={trip.status} />
      <span className="trip-row-check">
        {selected && (
          <>
            <Check size={20} weight="bold" aria-hidden="true" />
            <span className="sr-only">前回開いた旅行</span>
          </>
        )}
      </span>
    </Link>
  );
}
