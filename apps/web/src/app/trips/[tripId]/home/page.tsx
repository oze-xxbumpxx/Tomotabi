import { notFound } from "next/navigation";
import { HomeScreen } from "@/screens/home/home-screen";
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
  return <HomeScreen tripId={tripId} />;
}
