import { notFound } from "next/navigation";
import { SettlementScreen } from "@/screens/settlement/settlement-screen";
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
  return <SettlementScreen tripId={tripId} />;
}
