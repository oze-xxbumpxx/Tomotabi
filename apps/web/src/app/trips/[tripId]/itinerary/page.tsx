import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ItinerarySkeleton } from "@/screens/itinerary/itinerary-skeleton";
import { isUuidString } from "@/shared/lib/uuid";
import { ItineraryRoute } from "./itinerary-route";

/** 画面の部品をCDNから配るため、IDは前もって決めない（設計書 screen-speed のSS-06）。 */
export function generateStaticParams(): { tripId: string }[] {
  return [];
}

export default async function Page({
  params,
}: {
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await params;
  if (!isUuidString(tripId)) {
    notFound();
  }
  // useSearchParams()を使う部品はSuspenseで包む（包まないとページ全体がブラウザでの組み立てになる）。
  return (
    <Suspense fallback={<ItinerarySkeleton />}>
      <ItineraryRoute tripId={tripId} />
    </Suspense>
  );
}
