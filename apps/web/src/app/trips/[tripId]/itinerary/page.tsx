import { notFound } from "next/navigation";
import { ItineraryScreen } from "@/screens/itinerary/itinerary-screen";
import { isUuidString } from "@/shared/lib/uuid";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ tripId: string }>;
  searchParams: Promise<{ date?: string | string[] }>;
}) {
  const { tripId } = await params;
  if (!isUuidString(tripId)) {
    notFound();
  }
  const { date: raw } = await searchParams;
  // `date` は URL の値をそのまま渡す（省略は null = サーバー既定、
  // 空文字は送らない扱いで null）。複数指定は先頭だけ見る。
  const date =
    typeof raw === "string" && raw !== "" ? raw : Array.isArray(raw) && typeof raw[0] === "string" && raw[0] !== "" ? raw[0] : null;
  return <ItineraryScreen tripId={tripId} date={date} />;
}
