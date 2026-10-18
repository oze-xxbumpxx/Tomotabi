import { notFound } from "next/navigation";
import { HomeScreen } from "@/screens/home/home-screen";
import { isUuidString } from "@/shared/lib/uuid";

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
  return <HomeScreen tripId={tripId} />;
}
