"use client";

import { useSearchParams } from "next/navigation";
import { ItineraryScreen } from "@/screens/itinerary/itinerary-screen";
import { parseItineraryQuery } from "../route-query";

/** しおり（`?date=`）。問い合わせをブラウザで読み、画面に渡す（設計書 screen-speed のSS-06）。 */
export function ItineraryRoute({ tripId }: { tripId: string }) {
  const query = parseItineraryQuery(useSearchParams());
  return (
    <ItineraryScreen tripId={tripId} date={query.date} />
  );
}
