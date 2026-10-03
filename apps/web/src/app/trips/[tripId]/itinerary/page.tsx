import { notFound } from "next/navigation";
import { ItineraryScreen } from "@/screens/itinerary/itinerary-screen";
import { isLocalDateString } from "@/shared/lib/local-date";
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
  // `date`は実在する`YYYY-MM-DD`のときだけ渡す。省略・空文字・
  // 形式が違う値はnull（サーバー既定の日）。複数指定は先頭だけ見る。
  const candidate =
    typeof raw === "string" && raw !== "" ? raw : Array.isArray(raw) && typeof raw[0] === "string" && raw[0] !== "" ? raw[0] : null;
  const date =
    candidate !== null && isLocalDateString(candidate) ? candidate : null;
  return <ItineraryScreen tripId={tripId} date={date} />;
}
