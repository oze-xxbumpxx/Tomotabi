import { notFound } from "next/navigation";
import { ItineraryScreen } from "@/screens/itinerary/itinerary-screen";
import { isUuidString } from "@/shared/lib/uuid";

export default async function Page({
  params,
}: {
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await params;
  if (!isUuidString(tripId)) {
    notFound();
  }
  return <ItineraryScreen tripId={tripId} />;
}
